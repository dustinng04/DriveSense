import { PlatformScanAdapter, ScannedFile, PlatformContentAdapter } from '../scanner/types.js';
import { listGoogleDriveFiles, readGoogleDriveFileContent } from './service.js';

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
