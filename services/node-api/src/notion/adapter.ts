import { PlatformScanAdapter, ScannedFile, PlatformContentAdapter } from '../scanner/types.js';
import { listNotionBlockChildren, readNotionPage, readNotionPageMarkdown } from './service.js';

/**
 * Adapter for Notion platform to bridge between FileScanner and NotionService.
 */
export class NotionScanAdapter implements PlatformScanAdapter {
  readonly platform = 'notion';

  /**
   * Fetches child pages or database entries from a specific Notion resource.
   * Also includes the resource itself (page or database) in the results.
   * Notion API returns only pages and databases, so mimeType filtering is already implicit.
   */
  async listFiles(
    userId: string,
    accountId: string,
    resourceId: string,
    maxFiles: number,
  ): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];

    // Try to get the resource itself (page or database metadata)
    try {
      const resource = await readNotionPage(userId, accountId, resourceId);
      if (resource) {
        files.push(this.mapNotionPage(resource));
      }
    } catch (err) {
      // Ignore - might not be a valid page/database or permission issue
      console.debug('[NotionScanAdapter] Could not read resource itself:', err);
    }

    // Get children (child_page and child_database blocks)
    try {
      const blockResult = await listNotionBlockChildren({
        userId,
        accountId,
        blockId: resourceId,
        pageSize: maxFiles,
      });

      const childPages = (blockResult.results || [])
        .filter((block: any) => block.type === 'child_page' || block.type === 'child_database')
        .map((block: any) => this.mapNotionBlock(block));

      files.push(...childPages);
    } catch (err) {
      console.debug('[NotionScanAdapter] Could not list children:', err);
    }

    // Dedupe by ID (in case resource itself is also in children)
    const seen = new Set<string>();
    return files
      .filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      })
      .slice(0, maxFiles);
  }

  /**
   * Maps a Notion Page object (from GET /pages/{id}) to ScannedFile.
   */
  private mapNotionPage(page: any): ScannedFile {
    // Extract title from various possible locations
    let title = 'Untitled';

    // Database: page.title array
    if (Array.isArray(page.title) && page.title[0]?.plain_text) {
      title = page.title[0].plain_text;
    }
    // Page: page.properties.title or page.properties.Name
    else if (page.properties?.title?.title?.[0]?.plain_text) {
      title = page.properties.title.title[0].plain_text;
    } else if (page.properties?.Name?.title?.[0]?.plain_text) {
      title = page.properties.Name.title[0].plain_text;
    }

    const parentIds: string[] = [];
    if (page.parent?.page_id) parentIds.push(page.parent.page_id);
    if (page.parent?.database_id) parentIds.push(page.parent.database_id);

    return {
      id: page.id,
      name: title,
      mimeType:
        page.object === 'database'
          ? 'application/vnd.notion.database'
          : 'application/vnd.notion.page',
      modifiedAt: page.last_edited_time,
      createdAt: page.created_time,
      platform: 'notion',
      parentFolderIds: parentIds,
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
