import { PlatformScanAdapter, ScannedFile, PlatformContentAdapter } from '../scanner/types.js';
import { listNotionBlockChildren, queryNotionDatabase, readNotionPageMarkdown } from './service.js';

/**
 * Adapter for Notion platform to bridge between FileScanner and NotionService.
 */
export class NotionScanAdapter implements PlatformScanAdapter {
  readonly platform = 'notion';

  /**
   * Fetches child pages or database entries from a specific Notion resource.
   */
  async listFiles(
    userId: string,
    accountId: string,
    resourceId: string,
    maxFiles: number,
  ): Promise<ScannedFile[]> {
    // Determine if resource is a database or a page by attempting a database query first.
    // In a real implementation, we might check the ID format or use a cache.
    try {
      const dbResult = await queryNotionDatabase({
        userId,
        accountId,
        databaseId: resourceId,
        pageSize: maxFiles,
      });

      return (dbResult.results || []).map((page: any) => this.mapNotionPage(page));
    } catch (error) {
      // If database query fails, assume it's a page and fetch block children.
      const blockResult = await listNotionBlockChildren({
        userId,
        accountId,
        blockId: resourceId,
        pageSize: maxFiles,
      });

      // Filter for child_page and child_database blocks
      return (blockResult.results || [])
        .filter((block: any) => block.type === 'child_page' || block.type === 'child_database')
        .map((block: any) => this.mapNotionBlock(block));
    }
  }

  /**
   * Maps a Notion Page object to ScannedFile.
   */
  private mapNotionPage(page: any): ScannedFile {
    // Notion page titles are stored in properties.
    const titleProp = Object.values(page.properties || {}).find(
      (p: any) => p.type === 'title',
    ) as any;
    const name = titleProp?.title?.[0]?.plain_text || 'Untitled';

    return {
      id: page.id,
      name,
      mimeType: page.object === 'page' ? 'application/vnd.notion.page' : 'application/vnd.notion.database',
      modifiedAt: page.last_edited_time,
      createdAt: page.created_time,
      platform: 'notion',
      parentFolderIds: page.parent?.page_id ? [page.parent.page_id] : 
                       page.parent?.database_id ? [page.parent.database_id] : [],
    };
  }

  /**
   * Maps a Notion Block object (child_page/child_database) to ScannedFile.
   */
  private mapNotionBlock(block: any): ScannedFile {
    const isPage = block.type === 'child_page';
    return {
      id: block.id,
      name: isPage ? block.child_page.title : block.child_database.title,
      mimeType: isPage ? 'application/vnd.notion.page' : 'application/vnd.notion.database',
      modifiedAt: block.last_edited_time,
      createdAt: block.created_time,
      platform: 'notion',
      parentFolderIds: [block.parent?.page_id || block.parent?.database_id].filter(Boolean) as string[],
    };
  }
}

/**
 * Content adapter for Notion to fetch markdown content for similarity analysis.
 */
export class NotionContentAdapter implements PlatformContentAdapter {
  readonly platform = 'notion';

  /**
   * Fetch markdown content for analysis.
   * Uses Notion's markdown export endpoint.
   */
  async fetchTextContent(
    userId: string,
    accountId: string,
    pageId: string,
    mimeType: string,
  ): Promise<string | null> {
    return readNotionPageMarkdown(userId, accountId, pageId);
  }
}
