import { PlatformScanAdapter, ScannedFile, PlatformContentAdapter } from '../scanner/types.js';
import { listGoogleDriveFiles, readGoogleDriveFileContent } from './service.js';

/**
 * Adapter for Google Drive platform to bridge between FileScanner and GoogleDriveService.
 */
export class GoogleDriveScanAdapter implements PlatformScanAdapter {
  readonly platform = 'google_drive';

  /**
   * Fetches files from a specific Google Drive folder.
   */
  async listFiles(
    userId: string,
    accountId: string,
    resourceId: string,
    maxFiles: number,
  ): Promise<ScannedFile[]> {
    // Construct query to find files within the specific folder (resourceId)
    const raw = await listGoogleDriveFiles({
      userId,
      accountId,
      q: `'${resourceId}' in parents and trashed = false`,
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
