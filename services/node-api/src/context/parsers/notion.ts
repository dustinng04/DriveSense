import type { ContextParser, DetectedContext, ContextMetadata } from '../types.js';

/**
 * Notion URL parser
 * 
 * Handles various Notion URL formats:
 * - notion.so/{workspace}/{title-pageId}
 * - notion.so/{title-pageId}
 * - www.notion.so/{workspace}/{title-pageId}
 * 
 * Notion page IDs are typically 32-character hex strings at the end of the URL,
 * often prefixed with a slug/title. We extract the last 32+ character hex string.
 */
export class NotionParser implements ContextParser {
  platform = 'notion' as const;

  private readonly NOTION_PAGE_ID_PATTERN = /([a-f0-9]{32}|[a-f0-9-]{36})(?:\?|#|$)/i;

  canParse(url: string): boolean {
    return url.includes('notion.so');
  }

  parse(url: string, metadata?: ContextMetadata): DetectedContext {
    const pageMatch = url.match(this.NOTION_PAGE_ID_PATTERN);
    if (pageMatch) {
      return {
        platform: 'notion',
        contextType: 'page',
        resourceId: pageMatch[1],
        url,
        metadata,
      };
    }

    return {
      platform: 'notion',
      contextType: 'unknown',
      resourceId: null,
      url,
      metadata,
    };
  }
}
