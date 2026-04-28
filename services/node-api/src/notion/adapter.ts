import {
  PlatformScanAdapter,
  ScannedFile,
  PlatformContentAdapter,
  PlatformExecutionAdapter,
} from '../scanner/types.js';
import {
  listNotionBlockChildren,
  readNotionPage,
  readNotionPageMarkdown,
  updateNotionPage,
} from './service.js';

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

/**
 * Execution adapter for Notion to handle suggestion execution and undo operations.
 * Bridges between the executor and Notion API, managing blocks and page properties.
 */
export class NotionExecutionAdapter implements PlatformExecutionAdapter {
  readonly platform = 'notion';

  async getFileMetadata(
    userId: string,
    accountId: string,
    pageId: string,
  ): Promise<ScannedFile | null> {
    try {
      const page = (await readNotionPage(userId, accountId, pageId)) as Record<string, unknown>;
      return this.mapNotionPage(page);
    } catch {
      return null;
    }
  }

  async getFileContent(userId: string, accountId: string, pageId: string): Promise<string | null> {
    try {
      return readNotionPageMarkdown(userId, accountId, pageId);
    } catch {
      return null;
    }
  }

  async executeArchive(
    userId: string,
    accountId: string,
    pageId: string,
  ): Promise<Record<string, unknown>> {
    // Step: Archive the page
    await updateNotionPage({
      userId,
      accountId,
      pageId,
      inTrash: true,
    });

    // Return undo payload (pageId sufficient for unarchive)
    return {
      pageId,
    };
  }

  async executeRename(
    userId: string,
    accountId: string,
    pageId: string,
    newName: string,
  ): Promise<Record<string, unknown>> {
    // Get current title
    const page = (await readNotionPage(userId, accountId, pageId)) as Record<string, unknown>;
    const oldTitle = this.extractNotionTitle(page);

    // Rename via properties update
    await updateNotionPage({
      userId,
      accountId,
      pageId,
      properties: {
        title: [{ text: { content: newName } }],
      },
    });

    // Return undo payload
    return {
      pageId,
      oldTitle,
    };
  }

  async executeMerge(
    userId: string,
    accountId: string,
    survivorPageId: string,
    sourcePageId: string,
  ): Promise<Array<{ payload: Record<string, unknown>; step?: number }>> {
    // TODO: Implement Notion merge with block copying and source archiving
    throw new Error('Notion merge executor not yet implemented');
  }

  async executeEdit(
    userId: string,
    accountId: string,
    pageId: string,
    newContent: string,
  ): Promise<Record<string, unknown>> {
    // TODO: Implement Notion edit with block patching
    throw new Error('Notion edit executor not yet implemented');
  }

  async undoArchive(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    // TODO: Implement Notion unarchive operation
    throw new Error('Notion undo archive not yet implemented');
  }

  async undoRename(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    // TODO: Implement Notion rename to original title
    throw new Error('Notion undo rename not yet implemented');
  }

  async undoMerge(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
    step?: number,
  ): Promise<boolean> {
    // TODO: Implement Notion merge undo (delete appended blocks and unarchive source)
    throw new Error('Notion undo merge not yet implemented');
  }

  async undoEdit(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    // TODO: Implement Notion edit undo (restore block content)
    throw new Error('Notion undo edit not yet implemented');
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Maps a Notion Page object to ScannedFile.
   */
  private mapNotionPage(page: any): ScannedFile {
    let title = 'Untitled';
    if (Array.isArray(page.title) && page.title[0]?.plain_text) {
      title = page.title[0].plain_text;
    } else if (page.properties?.title?.title?.[0]?.plain_text) {
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
   * Extract title from Notion page properties.
   */
  private extractNotionTitle(page: Record<string, unknown>): string {
    const properties = page.properties as Record<string, unknown>;
    if (!properties || typeof properties !== 'object') return '';

    const titleProp = properties.title as Record<string, unknown>;
    if (!titleProp || typeof titleProp !== 'object') return '';

    const titleArray = titleProp.rich_text as unknown[];
    if (!Array.isArray(titleArray) || titleArray.length === 0) return '';

    const titleObj = titleArray[0] as Record<string, unknown>;
    const text = titleObj.text as Record<string, unknown>;
    return (text?.content as string) ?? '';
  }
}
