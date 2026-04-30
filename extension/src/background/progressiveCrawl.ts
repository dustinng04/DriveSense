/**
 * Progressive crawl queue for building metadata index.
 * 
 * Workflow:
 * 1. User opens folder → crawl it (priority 0)
 * 2. Extract parent from results → crawl parent (priority 1)
 * 3. From parent, discover siblings → crawl siblings (priority 2)
 * 4. Expand outward progressively with limits
 * 
 * Abort conditions:
 * - User navigates to new folder → clear queue, prioritize new folder
 * - Tab inactive → pause queue
 * - Max depth/folders reached → stop
 */

import { fetchFolderFiles } from '../shared/api.js';
import { upsertFilesFromCrawl, isFolderCrawlFresh } from '../shared/metadataIndex.js';
import type { Platform } from '../shared/types.js';

const LOG_PREFIX = '[ProgressiveCrawl]';

export interface CrawlTask {
  folderId: string;
  platform: Platform;
  accountId: string;
  priority: number;      // 0=current, 1=parent, 2=sibling, 3+=discovered
  depth: number;         // Current depth from initial folder
  discoveredFrom?: string; // Breadcrumb tracking
}

interface CrawlQueueState {
  tasks: CrawlTask[];
  crawled: Set<string>;          // Dedupe by folderId
  inProgress: boolean;
  pauseReason: 'user_navigation' | 'tab_inactive' | null;
  stats: {
    totalFolders: number;
    totalFiles: number;
    startedAt: number;
  };
}

export class ProgressiveCrawlQueue {
  private state: CrawlQueueState;
  private readonly MAX_DEPTH = 2;
  private readonly MAX_FOLDERS = 50;
  private readonly MAX_SIBLINGS_PER_FOLDER = 10;
  private readonly CRAWL_DELAY_MS = 2000; // 2s between folders for rate limiting

  constructor() {
    this.state = {
      tasks: [],
      crawled: new Set(),
      inProgress: false,
      pauseReason: null,
      stats: {
        totalFolders: 0,
        totalFiles: 0,
        startedAt: 0,
      },
    };
  }

  /**
   * Add a crawl task to the queue.
   * Deduplicates automatically.
   */
  async enqueue(task: CrawlTask): Promise<void> {
    // Skip if already crawled or in queue
    if (this.state.crawled.has(task.folderId)) {
      console.debug(LOG_PREFIX, `Skipping already crawled folder: ${task.folderId}`);
      return;
    }

    if (this.state.tasks.some(t => t.folderId === task.folderId)) {
      console.debug(LOG_PREFIX, `Skipping duplicate task: ${task.folderId}`);
      return;
    }

    // Check if folder is already fresh in index
    const isFresh = await isFolderCrawlFresh(task.platform, task.accountId, task.folderId);
    if (isFresh) {
      console.debug(LOG_PREFIX, `Skipping fresh folder: ${task.folderId}`);
      this.state.crawled.add(task.folderId); // Mark as crawled to prevent re-queuing
      return;
    }

    this.state.tasks.push(task);
    console.debug(LOG_PREFIX, `Enqueued: ${task.folderId} (priority ${task.priority}, depth ${task.depth})`);
  }

  /**
   * Process the queue progressively.
   * Non-blocking - runs in background.
   */
  async processQueue(): Promise<void> {
    if (this.state.inProgress) {
      console.debug(LOG_PREFIX, 'Queue already processing');
      return;
    }

    if (this.state.tasks.length === 0) {
      console.debug(LOG_PREFIX, 'Queue is empty');
      return;
    }

    this.state.inProgress = true;
    this.state.stats.startedAt = Date.now();

    console.log(LOG_PREFIX, `Starting queue processing: ${this.state.tasks.length} tasks`);

    while (this.state.tasks.length > 0) {
      // Check pause conditions
      if (this.state.pauseReason) {
        console.log(LOG_PREFIX, `Paused: ${this.state.pauseReason}`);
        break;
      }

      // Check folder limit
      if (this.state.crawled.size >= this.MAX_FOLDERS) {
        console.log(LOG_PREFIX, `Max folders reached (${this.MAX_FOLDERS})`);
        break;
      }

      // Sort by priority (lower = higher priority), then by depth
      this.state.tasks.sort((a, b) => 
        a.priority - b.priority || a.depth - b.depth
      );

      const task = this.state.tasks.shift()!;

      // Skip if already crawled (defensive check)
      if (this.state.crawled.has(task.folderId)) {
        continue;
      }

      try {
        await this.processTask(task);
      } catch (error) {
        console.error(LOG_PREFIX, `Failed to process task ${task.folderId}:`, error);
        // Continue with next task
      }

      // Rate limiting delay
      await this.sleep(this.CRAWL_DELAY_MS);
    }

    this.state.inProgress = false;

    const duration = ((Date.now() - this.state.stats.startedAt) / 1000).toFixed(1);
    console.log(
      LOG_PREFIX,
      `Complete: ${this.state.crawled.size} folders, ${this.state.stats.totalFiles} files in ${duration}s`
    );
  }

  /**
   * Process a single crawl task.
   */
  private async processTask(task: CrawlTask): Promise<void> {
    console.debug(LOG_PREFIX, `Crawling folder: ${task.folderId} (priority ${task.priority}, depth ${task.depth})`);

    // Fetch folder files
    const files = await fetchFolderFiles(task.platform, task.folderId);

    if (files.length === 0) {
      console.debug(LOG_PREFIX, `No files in folder ${task.folderId}`);
      this.state.crawled.add(task.folderId);
      return;
    }

    // Update index
    await upsertFilesFromCrawl(task.platform, task.accountId, task.folderId, files);

    this.state.crawled.add(task.folderId);
    this.state.stats.totalFolders++;
    this.state.stats.totalFiles += files.length;

    console.log(
      LOG_PREFIX,
      `Crawled ${task.folderId}: ${files.length} files (total: ${this.state.stats.totalFolders} folders, ${this.state.stats.totalFiles} files)`
    );

    // Discover related folders if within depth limit
    if (task.depth < this.MAX_DEPTH) {
      await this.discoverRelatedFolders(task, files);
    }
  }

  /**
   * Discover parent and sibling folders from crawl results.
   */
  private async discoverRelatedFolders(task: CrawlTask, files: any[]): Promise<void> {
    // 1. Discover parent folders (priority 1)
    const parentIds = this.extractParentIds(files);
    for (const parentId of parentIds) {
      await this.enqueue({
        folderId: parentId,
        platform: task.platform,
        accountId: task.accountId,
        priority: 1,
        depth: task.depth + 1,
        discoveredFrom: task.folderId,
      });
    }

    // 2. Discover siblings (priority 2)
    // Only discover siblings from current folder (priority 0) and parent (priority 1)
    // Don't discover siblings of siblings to prevent exponential growth
    if (task.priority <= 1 && parentIds.length > 0) {
      const siblings = await this.discoverSiblings(
        task.platform,
        task.accountId,
        task.folderId,
        parentIds[0]
      );

      for (const siblingId of siblings) {
        await this.enqueue({
          folderId: siblingId,
          platform: task.platform,
          accountId: task.accountId,
          priority: 2,
          depth: task.depth,
          discoveredFrom: task.folderId,
        });
      }
    }
  }

  /**
   * Extract unique parent folder IDs from file results.
   */
  private extractParentIds(files: any[]): string[] {
    const parents = new Set<string>();
    for (const file of files) {
      if (file.parentFolderIds && Array.isArray(file.parentFolderIds) && file.parentFolderIds.length > 0) {
        for (const parentId of file.parentFolderIds) {
          if (parentId && typeof parentId === 'string') {
            parents.add(parentId);
          }
        }
      }
    }
    return Array.from(parents);
  }

  /**
   * Discover sibling folders by fetching parent's children.
   */
  private async discoverSiblings(
    platform: Platform,
    accountId: string,
    currentFolderId: string,
    parentId: string
  ): Promise<string[]> {
    try {
      // Check if parent is already crawled
      const isFresh = await isFolderCrawlFresh(platform, accountId, parentId);
      if (!isFresh) {
        // Fetch parent folder to get siblings
        const parentFiles = await fetchFolderFiles(platform, parentId);

        // Filter for folders only (Google Drive mimeType), exclude current folder
        const siblings = parentFiles
          .filter(f => 
            f.mimeType === 'application/vnd.google-apps.folder' &&
            f.id !== currentFolderId
          )
          .map(f => f.id)
          .slice(0, this.MAX_SIBLINGS_PER_FOLDER); // Limit siblings

        console.debug(LOG_PREFIX, `Discovered ${siblings.length} siblings from parent ${parentId}`);
        return siblings;
      }

      return [];
    } catch (error) {
      console.error(LOG_PREFIX, `Failed to discover siblings from parent ${parentId}:`, error);
      return [];
    }
  }

  /**
   * Pause the queue.
   */
  pause(reason: 'user_navigation' | 'tab_inactive'): void {
    this.state.pauseReason = reason;
    console.log(LOG_PREFIX, `Paused: ${reason}`);
  }

  /**
   * Resume the queue.
   */
  resume(): void {
    if (this.state.pauseReason) {
      console.log(LOG_PREFIX, 'Resumed');
      this.state.pauseReason = null;

      // Restart processing if there are pending tasks
      if (this.state.tasks.length > 0 && !this.state.inProgress) {
        void this.processQueue();
      }
    }
  }

  /**
   * Clear the queue and reset state.
   * Used when user navigates to a new folder.
   */
  clear(): void {
    this.state.tasks = [];
    this.state.pauseReason = null;
    console.log(LOG_PREFIX, 'Queue cleared');
  }

  /**
   * Get current queue stats.
   */
  getStats() {
    return {
      queuedTasks: this.state.tasks.length,
      crawledFolders: this.state.crawled.size,
      totalFiles: this.state.stats.totalFiles,
      inProgress: this.state.inProgress,
      paused: this.state.pauseReason !== null,
    };
  }

  /**
   * Sleep utility for rate limiting.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
