import type { ContextParser, DetectedContext, ContextMetadata } from '../types.js';

/**
 * Google Drive URL parser
 * 
 * Handles various Google Drive and Google Docs URL formats:
 * - drive.google.com/drive/folders/{id}
 * - drive.google.com/file/d/{id}/view
 * - docs.google.com/document/d/{id}/edit
 * - docs.google.com/spreadsheets/d/{id}/edit
 * - docs.google.com/presentation/d/{id}/edit
 * - docs.google.com/forms/d/{id}/edit
 */
export class DriveParser implements ContextParser {
  platform = 'google_drive' as const;

  private readonly DRIVE_FOLDER_PATTERN = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/;
  private readonly DRIVE_FILE_PATTERN = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;
  private readonly DOCS_PATTERN = /docs\.google\.com\/(document|spreadsheets|presentation|forms)\/d\/([a-zA-Z0-9_-]+)/;

  canParse(url: string): boolean {
    return url.includes('drive.google.com') || url.includes('docs.google.com');
  }

  parse(url: string, metadata?: ContextMetadata): DetectedContext {
    const folderMatch = url.match(this.DRIVE_FOLDER_PATTERN);
    if (folderMatch) {
      return {
        platform: 'google_drive',
        contextType: 'folder',
        resourceId: folderMatch[1],
        url,
        metadata,
      };
    }

    const fileMatch = url.match(this.DRIVE_FILE_PATTERN);
    if (fileMatch) {
      return {
        platform: 'google_drive',
        contextType: 'file',
        resourceId: fileMatch[1],
        url,
        metadata,
      };
    }

    const docsMatch = url.match(this.DOCS_PATTERN);
    if (docsMatch) {
      return {
        platform: 'google_drive',
        contextType: 'file',
        resourceId: docsMatch[2],
        url,
        metadata,
      };
    }

    return {
      platform: 'google_drive',
      contextType: 'unknown',
      resourceId: null,
      url,
      metadata,
    };
  }
}
