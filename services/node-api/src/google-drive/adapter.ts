import {
  PlatformScanAdapter,
  ScannedFile,
  PlatformContentAdapter,
  PlatformExecutionAdapter,
  EditPatch,
} from '../scanner/types.js';
import { applyOpsLocally } from '../suggestions/editPatch.js';
import {
  listGoogleDriveRevisions,
  listGoogleDriveFiles,
  readGoogleDriveFileContent,
  readGoogleDriveFileMetadata,
  readGoogleDriveRevisionContent,
  trashGoogleDriveFile,
  updateGoogleDriveRevision,
  uploadGoogleDriveFileContent,
} from './service.js';

// MimeTypes that DriveSense can analyze for Google Drive
const ALLOWED_GOOGLE_DRIVE_MIMETYPES = [
  'application/vnd.google-apps.document',      // Google Docs
  'application/vnd.google-apps.spreadsheet',   // Google Sheets
  'application/pdf',                            // PDF
  'text/plain',                                 // Plain text
  'text/markdown',                              // Markdown
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
];

/**
 * Adapter for Google Drive platform to bridge between FileScanner and GoogleDriveService.
 */
export class GoogleDriveScanAdapter implements PlatformScanAdapter {
  readonly platform = 'google_drive';

  /**
   * Fetches files from a specific Google Drive folder.
   * Filters by allowed mimeTypes directly in the query for better performance.
   */
  async listFiles(
    userId: string,
    accountId: string,
    resourceId: string,
    maxFiles: number,
  ): Promise<ScannedFile[]> {
    // Build mimeType query: mimeType = 'type1' or mimeType = 'type2' ...
    const mimeTypeQuery = ALLOWED_GOOGLE_DRIVE_MIMETYPES
      .map((mt) => `mimeType = '${mt}'`)
      .join(' or ');

    // Construct query to find files within the specific folder and matching allowed mimeTypes
    const raw = await listGoogleDriveFiles({
      userId,
      accountId,
      q: `'${resourceId}' in parents and trashed = false and (${mimeTypeQuery})`,
      pageSize: maxFiles,
    });

    // Map Google-specific file metadata to the unified ScannedFile interface
    return (raw.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedAt: f.modifiedTime,
      sizeBytes: f.size ? parseInt(f.size, 10) : undefined,
      platform: 'google_drive',
      parentFolderIds: f.parents || [],
    }));
  }
}

/**
 * Content adapter for Google Drive to fetch text content for similarity analysis.
 */
export class GoogleDriveContentAdapter implements PlatformContentAdapter {
  readonly platform = 'google_drive';

  /**
   * Fetch text content for analysis.
   * Skips Google Sheets (metadata-only staleness).
   * Exports Google Docs as plain text, fetches other files as-is.
   */
  async fetchTextContent(
    userId: string,
    accountId: string,
    fileId: string,
    mimeType: string,
  ): Promise<string | null> {
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      return null;
    }

    const result = await readGoogleDriveFileContent(userId, accountId, fileId);
    const buffer = Buffer.from(result.contentBase64, 'base64');
    return buffer.toString('utf-8');
  }
}

/**
 * Execution adapter for Google Drive to handle suggestion execution and undo operations.
 * Bridges between the executor and Google Drive API, managing revisions and content updates.
 */
export class GoogleDriveExecutionAdapter implements PlatformExecutionAdapter {
  readonly platform = 'google_drive';

  async getFileMetadata(
    userId: string,
    accountId: string,
    fileId: string,
  ): Promise<ScannedFile | null> {
    try {
      const metadata = (await readGoogleDriveFileMetadata(userId, accountId, fileId)) as Record<
        string,
        unknown
      >;
      return {
        id: metadata.id as string,
        name: metadata.name as string,
        mimeType: metadata.mimeType as string,
        modifiedAt: metadata.modifiedTime as string,
        sizeBytes: metadata.size ? parseInt(metadata.size as string, 10) : undefined,
        platform: 'google_drive',
        parentFolderIds: (metadata.parents as string[]) || [],
      };
    } catch {
      return null;
    }
  }

  async getFileContent(userId: string, accountId: string, fileId: string): Promise<string | null> {
    try {
      const result = await readGoogleDriveFileContent(userId, accountId, fileId);
      const buffer = Buffer.from(result.contentBase64, 'base64');
      return buffer.toString('utf-8');
    } catch {
      return null;
    }
  }

  async executeArchive(
    userId: string,
    accountId: string,
    fileId: string,
  ): Promise<Record<string, unknown>> {
    // Step: Trash the file
    await trashGoogleDriveFile(userId, accountId, fileId);

    // Return undo payload (fileId sufficient for untrash)
    return {
      fileId,
    };
  }

  async executeRename(
    userId: string,
    accountId: string,
    fileId: string,
    newName: string,
  ): Promise<Record<string, unknown>> {
    // Get current name before rename
    const metadata = (await readGoogleDriveFileMetadata(userId, accountId, fileId)) as Record<
      string,
      unknown
    >;
    const oldName = metadata.name as string;

    // TODO: Implement Drive rename via PATCH /files/{fileId}
    throw new Error('Drive rename executor not yet implemented');
  }

  async executeMerge(
    userId: string,
    accountId: string,
    survivorId: string,
    sourceId: string,
  ): Promise<Array<{ payload: Record<string, unknown>; step?: number }>> {
    // TODO: Implement Drive merge with revision pinning and content append
    throw new Error('Drive merge executor not yet implemented');
  }

  async executeEdit(
    userId: string,
    accountId: string,
    fileId: string,
    editPatch: EditPatch,
  ): Promise<Record<string, unknown>> {
    const metadata = (await readGoogleDriveFileMetadata(userId, accountId, fileId)) as {
      mimeType: string;
      name: string;
    };

    if (metadata.mimeType === 'application/vnd.google-apps.document') {
      throw new Error('Drive edit is blocked for native Google Docs in MVP to avoid losing formatting');
    }
    if (metadata.mimeType.startsWith('application/vnd.google-apps')) {
      throw new Error(`Drive edit is not supported for native Google Workspace type ${metadata.mimeType}`);
    }
    if (!this.isEditableBlobMimeType(metadata.mimeType)) {
      throw new Error(`Drive edit is not supported for ${metadata.mimeType}`);
    }

    const current = await readGoogleDriveFileContent(userId, accountId, fileId);
    const previousContent = Buffer.from(current.contentBase64, 'base64').toString('utf-8');
    const applied = applyOpsLocally(previousContent, editPatch);

    const revisions = await listGoogleDriveRevisions(userId, accountId, fileId);
    const previousRevisionId = revisions.revisions?.at(-1)?.id;
    if (!previousRevisionId) {
      throw new Error('Drive edit could not identify the current revision');
    }

    if (applied.appliedUpdates.length > 0) {
      await uploadGoogleDriveFileContent({
        userId,
        accountId,
        fileId,
        content: applied.content,
        contentType: current.contentType || metadata.mimeType,
      });

      await updateGoogleDriveRevision({
        userId,
        accountId,
        fileId,
        revisionId: previousRevisionId,
        keepForever: true,
      });
    }

    return {
      platform: 'drive',
      strategy: 'revision',
      fileId,
      revisionId: previousRevisionId,
      keepForever: applied.appliedUpdates.length > 0,
      outcome: applied.outcome,
      appliedCount: applied.appliedUpdates.length,
      skippedUpdates: applied.skippedUpdates,
    };
  }

  async undoArchive(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    // TODO: Implement Drive untrash operation
    throw new Error('Drive undo archive not yet implemented');
  }

  async undoRename(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    // TODO: Implement Drive rename to original name
    throw new Error('Drive undo rename not yet implemented');
  }

  async undoMerge(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
    step?: number,
  ): Promise<boolean> {
    // TODO: Implement Drive merge undo (restore content from revision)
    throw new Error('Drive undo merge not yet implemented');
  }

  async undoEdit(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const fileId = typeof undoPayload.fileId === 'string' ? undoPayload.fileId : '';
    const revisionId = typeof undoPayload.revisionId === 'string' ? undoPayload.revisionId : '';
    if (!fileId || !revisionId) {
      throw new Error('Invalid Drive edit undo payload');
    }

    const metadata = (await readGoogleDriveFileMetadata(userId, accountId, fileId)) as {
      mimeType: string;
    };
    const content = await readGoogleDriveRevisionContent(userId, accountId, fileId, revisionId);

    await uploadGoogleDriveFileContent({
      userId,
      accountId,
      fileId,
      content,
      contentType: this.isEditableBlobMimeType(metadata.mimeType) ? metadata.mimeType : 'text/plain',
    });

    if (undoPayload.keepForever === true) {
      await updateGoogleDriveRevision({
        userId,
        accountId,
        fileId,
        revisionId,
        keepForever: false,
      });
    }

    return true;
  }

  private isEditableBlobMimeType(mimeType: string): boolean {
    return mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown';
  }
}
