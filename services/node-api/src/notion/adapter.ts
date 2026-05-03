import { UpstreamApiError } from '../integrations/errors.js';
import {
  PlatformScanAdapter,
  ScannedFile,
  PlatformContentAdapter,
  PlatformExecutionAdapter,
  EditPatch,
  ContentUpdate,
} from '../scanner/types.js';
import { applyOpsLocally, countOccurrences } from '../suggestions/editPatch.js';
import {
  listNotionBlockChildren,
  readNotionPage,
  readNotionPageMarkdown,
  replaceNotionPageMarkdown,
  updateNotionPageMarkdown,
  updateNotionPage,
  searchNotionPages,
} from './service.js';

function extractTitlePlainText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const first = value[0] as Record<string, unknown> | undefined;
  if (!first) {
    return null;
  }

  if (typeof first.plain_text === 'string' && first.plain_text.trim().length > 0) {
    return first.plain_text;
  }

  const text = first.text as Record<string, unknown> | undefined;
  if (typeof text?.content === 'string' && text.content.trim().length > 0) {
    return text.content;
  }

  return null;
}

function resolveNotionPageTitle(page: Record<string, unknown>): string {
  const topLevelTitle = extractTitlePlainText(page.title);
  if (topLevelTitle) {
    return topLevelTitle;
  }

  const properties = page.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const property of Object.values(properties as Record<string, unknown>)) {
      if (!property || typeof property !== 'object' || Array.isArray(property)) {
        continue;
      }

      const propertyRecord = property as Record<string, unknown>;
      if (propertyRecord.type !== 'title') {
        continue;
      }

      const title = extractTitlePlainText(propertyRecord.title);
      if (title) {
        return title;
      }
    }
  }

  return 'Untitled';
}

function mapNotionPageToScannedFile(page: {
  id: string;
  object?: string;
  last_edited_time: string;
  created_time: string;
  parent?: { page_id?: string; database_id?: string };
}): ScannedFile {
  const parentIds: string[] = [];
  if (page.parent?.page_id) parentIds.push(page.parent.page_id);
  if (page.parent?.database_id) parentIds.push(page.parent.database_id);

  return {
    id: page.id,
    name: resolveNotionPageTitle(page as Record<string, unknown>),
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
    let isWorkspaceRoot = false;

    // Try to get the resource itself (page or database metadata)
    try {
      const resource = await readNotionPage(userId, accountId, resourceId);
      if (resource) {
        if (resource.parent?.type === 'workspace') {
          isWorkspaceRoot = true;
        }
        files.push(this.mapNotionPage(resource));
      }
    } catch (err) {
      // If 404, might be workspace root - try search API
      if (err instanceof UpstreamApiError && err.statusCode === 404) {
        isWorkspaceRoot = true;
      }
      console.log('[NotionScanAdapter] Could not read resource itself:', err);
    }

    // If workspace root, use search API instead of block children
    if (isWorkspaceRoot) {
      try {
        const searchResult = await searchNotionPages(userId, accountId, {
          pageSize: maxFiles,
        }) as any;
        
        const pages = (searchResult.results || [])
          .filter((item: any) => item.object === 'page')
          .map((item: any) => this.mapNotionPage(item));
        
        files.push(...pages);
      } catch (err) {
        console.debug('[NotionScanAdapter] Could not search workspace:', err);
      }
    } else {
      // Get children (child_page and child_database blocks)
      try {
        const blockResult = await listNotionBlockChildren({
          userId,
          accountId,
          blockId: resourceId,
          pageSize: maxFiles,
        }) as any;

        const childPages = (blockResult.results || [])
          .filter((block: any) => block.type === 'child_page' || block.type === 'child_database')
          .map((block: any) => this.mapNotionBlock(block));

        files.push(...childPages);
      } catch (err) {
        console.debug('[NotionScanAdapter] Could not list children:', err);
      }
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
    return mapNotionPageToScannedFile(page);
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

  private hasTruncatedMarkdownResult(result: Record<string, unknown>): boolean {
    return (
      result.truncated === true ||
      (Array.isArray(result.unknown_block_ids) && result.unknown_block_ids.length > 0)
    );
  }

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
    const survivorMarkdown = await readNotionPageMarkdown(userId, accountId, survivorPageId);
    const sourceMarkdown = await readNotionPageMarkdown(userId, accountId, sourcePageId);
    const survivorChanged = sourceMarkdown.trim().length > 0;

    if (survivorChanged) {
      // Use search & replace to append source content to survivor
      // Match the entire survivor content and replace with merged version
      const mergedContent = survivorMarkdown.trim()
        ? `${survivorMarkdown.trim()}\n\n---\n\n${sourceMarkdown.trim()}`
        : sourceMarkdown.trim();
      
      const result = await updateNotionPageMarkdown({
        userId,
        accountId,
        pageId: survivorPageId,
        contentUpdates: [{
          old_str: survivorMarkdown,
          new_str: mergedContent,
          replace_all_matches: false,
        }],
      }) as Record<string, unknown>;

      if (this.hasTruncatedMarkdownResult(result)) {
        throw new Error('Notion merge markdown update returned truncated content');
      }
    }

    try {
      await updateNotionPage({
        userId,
        accountId,
        pageId: sourcePageId,
        inTrash: true,
      });
    } catch (error) {
      if (survivorChanged) {
        await replaceNotionPageMarkdown({
          userId,
          accountId,
          pageId: survivorPageId,
          markdown: survivorMarkdown,
        });
      }
      throw error;
    }

    return [
      {
        step: 1,
        payload: {
          survivorPageId,
          previousMarkdown: survivorMarkdown,
          strategy: 'replace_content',
        },
      },
      {
        step: 2,
        payload: {
          sourcePageId,
        },
      },
    ];
  }

  async executeEdit(
    userId: string,
    accountId: string,
    pageId: string,
    editPatch: EditPatch,
  ): Promise<Record<string, unknown>> {
    const previousMarkdown = await readNotionPageMarkdown(userId, accountId, pageId);
    const applied = applyOpsLocally(previousMarkdown, editPatch);

    if (applied.appliedUpdates.length > 0) {
      const result = await updateNotionPageMarkdown({
        userId,
        accountId,
        pageId,
        contentUpdates: applied.appliedUpdates,
      }) as Record<string, unknown>;

      if (this.hasTruncatedMarkdownResult(result)) {
        throw new Error('Notion markdown update returned truncated content; edit was not considered safe');
      }
    }

    return {
      platform: 'notion',
      strategy: 'replace_content',
      pageId,
      previousMarkdown,
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
    const pageId = typeof undoPayload.pageId === 'string' ? undoPayload.pageId : '';
    if (!pageId) {
      throw new Error('Invalid Notion archive undo payload');
    }

    await updateNotionPage({
      userId,
      accountId,
      pageId,
      inTrash: false,
    });

    return true;
  }

  async undoRename(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const pageId = typeof undoPayload.pageId === 'string' ? undoPayload.pageId : '';
    const oldTitle = typeof undoPayload.oldTitle === 'string' ? undoPayload.oldTitle : '';

    if (!pageId) {
      throw new Error('Invalid Notion rename undo payload');
    }

    await updateNotionPage({
      userId,
      accountId,
      pageId,
      properties: {
        title: [{ text: { content: oldTitle } }],
      },
    });

    return true;
  }

  async undoMerge(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
    step?: number,
  ): Promise<boolean> {
    if (step === 2) {
      const sourcePageId = typeof undoPayload.sourcePageId === 'string' ? undoPayload.sourcePageId : '';
      if (!sourcePageId) {
        throw new Error('Invalid Notion merge archive undo payload');
      }

      await updateNotionPage({
        userId,
        accountId,
        pageId: sourcePageId,
        inTrash: false,
      });

      return true;
    }

    if (step === 1) {
      const survivorPageId =
        typeof undoPayload.survivorPageId === 'string' ? undoPayload.survivorPageId : '';
      const previousMarkdown =
        typeof undoPayload.previousMarkdown === 'string' ? undoPayload.previousMarkdown : '';

      if (!survivorPageId) {
        throw new Error('Invalid Notion merge content undo payload');
      }

      const result = await replaceNotionPageMarkdown({
        userId,
        accountId,
        pageId: survivorPageId,
        markdown: previousMarkdown,
      }) as Record<string, unknown>;

      if (this.hasTruncatedMarkdownResult(result)) {
        throw new Error('Notion merge restore returned truncated content');
      }

      return true;
    }

    throw new Error(`Unsupported Notion merge undo step '${String(step)}'`);
  }

  async undoEdit(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
  ): Promise<boolean> {
    const pageId = typeof undoPayload.pageId === 'string' ? undoPayload.pageId : '';
    const previousMarkdown =
      typeof undoPayload.previousMarkdown === 'string' ? undoPayload.previousMarkdown : '';

    if (!pageId || !previousMarkdown) {
      throw new Error('Invalid Notion edit undo payload');
    }

    const result = await replaceNotionPageMarkdown({
      userId,
      accountId,
      pageId,
      markdown: previousMarkdown,
    }) as Record<string, unknown>;

    if (this.hasTruncatedMarkdownResult(result)) {
      throw new Error('Notion markdown restore returned truncated content');
    }

    return true;
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Maps a Notion Page object to ScannedFile.
   */
  private mapNotionPage(page: any): ScannedFile {
    return mapNotionPageToScannedFile(page);
  }

  /**
   * Extract title from Notion page properties.
   */
  private extractNotionTitle(page: Record<string, unknown>): string {
    const title = resolveNotionPageTitle(page);
    return title === 'Untitled' ? '' : title;
  }

  private buildMergeContentUpdate(survivorMarkdown: string, sourceMarkdown: string): ContentUpdate | null {
    const source = sourceMarkdown.trim();

    if (!source) {
      return null;
    }
    if (!survivorMarkdown.trim()) {
      return null;
    }

    const anchor = this.findUniqueTailAnchor(survivorMarkdown);
    if (!anchor) {
      throw new Error('Notion merge could not find a unique tail anchor for append-style update');
    }

    return {
      old_str: anchor,
      new_str: `${anchor}\n\n---\n\n${source}`,
      replace_all_matches: false,
    };
  }

  private findUniqueTailAnchor(content: string): string | null {
    const trimmed = content.trimEnd();
    const anchorLengths = [500, 300, 200, 120, 80, 40];

    for (const length of anchorLengths) {
      if (trimmed.length < length) continue;
      const anchor = trimmed.slice(-length).trim();
      if (!anchor) continue;
      if (countOccurrences(content, anchor) === 1) {
        return anchor;
      }
    }

    return null;
  }
}
