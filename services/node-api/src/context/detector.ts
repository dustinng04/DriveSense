import type { DetectedContext, ContextMetadata, ContextParser } from './types.js';
import { DriveParser } from './parsers/drive.js';
import { NotionParser } from './parsers/notion.js';

/**
 * Context detector that identifies the platform and resource from a URL
 * 
 * This is the main entry point for context detection. It uses platform-specific
 * parsers to identify Google Drive files/folders or Notion pages.
 */
export class ContextDetector {
  private parsers: ContextParser[];

  constructor() {
    this.parsers = [
      new DriveParser(),
      new NotionParser(),
    ];
  }

  /**
   * Detect context from a URL
   * 
   * @param url - The URL to parse
   * @param metadata - Optional metadata (title, path) from the page
   * @returns Detected context with platform, type, and resource ID
   */
  detect(url: string, metadata?: ContextMetadata): DetectedContext {
    for (const parser of this.parsers) {
      if (parser.canParse(url)) {
        return parser.parse(url, metadata);
      }
    }

    return {
      platform: 'unknown',
      contextType: 'unknown',
      resourceId: null,
      url,
      metadata,
    };
  }

  /**
   * Get all registered parsers
   */
  getParsers(): ContextParser[] {
    return this.parsers;
  }

  /**
   * Register a custom parser
   */
  registerParser(parser: ContextParser): void {
    this.parsers.push(parser);
  }
}

export const contextDetector = new ContextDetector();
