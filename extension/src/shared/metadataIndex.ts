/**
 * Local metadata index manager for the DriveSense extension.
 *
 * Maintains a browser-local cache of file metadata organized by account and folder.
 * Supports TTL-based freshness checking, LRU eviction, and multi-account isolation.
 */

import type { MetadataIndex, IndexedFile, FolderCrawlState, Platform } from './types.js';
import { storageGet, storageSet } from './storage.js';

const SCHEMA_VERSION = 1;
const FOLDER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STORAGE_SIZE_LIMIT = 9 * 1024 * 1024; // 9MB (leave 1MB buffer under Chrome's 10MB limit)

/**
 * Compose a flat key for the index from platform, OAuth account id (`account_id`), and resource ID.
 */
function composeKey(platform: Platform, accountId: string, resourceId: string): string {
  return `${platform}:${accountId}:${resourceId}`;
}

/**
 * Check if the stored index schema version is current.
 * Returns true if index is valid; false if stale and needs purge.
 */
function isSchemaValid(index: MetadataIndex): boolean {
  return index.version === SCHEMA_VERSION;
}

/**
 * Check if a folder crawl is fresh (< 24h old).
 */
function isCrawlFresh(crawlState: FolderCrawlState): boolean {
  const ageMs = Date.now() - crawlState.crawledAt;
  return ageMs < FOLDER_TTL_MS;
}

/**
 * Get the current index from storage, validating schema version.
 * Returns a fresh empty index if validation fails.
 */
async function getIndex(): Promise<MetadataIndex> {
  const { metadataIndex } = await storageGet('metadataIndex');
  if (!isSchemaValid(metadataIndex)) {
    return {
      version: SCHEMA_VERSION,
      entries: {},
      folderCrawls: {},
    };
  }
  return metadataIndex;
}

/**
 * Check if a folder crawl is fresh without loading the full index.
 * Useful as a lightweight pre-check before deciding to fetch files from platform API.
 */
export async function isFolderCrawlFresh(
  platform: Platform,
  accountId: string,
  folderId: string,
): Promise<boolean> {
  const index = await getIndex();
  const key = composeKey(platform, accountId, folderId);
  const crawlState = index.folderCrawls[key];
  return crawlState ? isCrawlFresh(crawlState) : false;
}

/**
 * Get all files from the index belonging to a specific folder (without fetching from platform).
 * Returns an empty array if the folder is not in the index or crawl is stale.
 */
export async function getFilesInFolderFromIndex(
  platform: Platform,
  accountId: string,
  folderId: string,
): Promise<IndexedFile[]> {
  const index = await getIndex();
  const folderKey = composeKey(platform, accountId, folderId);

  // If folder is not in index or crawl is stale, return empty (caller should fetch from API)
  if (!index.folderCrawls[folderKey] || !isCrawlFresh(index.folderCrawls[folderKey])) {
    return [];
  }

  const prefix = `${platform}:${accountId}:`;
  return Object.entries(index.entries)
    .filter(([key, file]) => key.startsWith(prefix) && file.parentFolderIds.includes(folderId))
    .map(([, file]) => file);
}

/**
 * Upsert files into the index after a folder crawl.
 * Handles multi-folder tracking and cleans up ghost entries.
 *
 * @param platform - Platform (google_drive or notion)
 * @param accountId - OAuth `account_id` for namespacing
 * @param folderId - Folder/page ID being crawled
 * @param scannedFiles - Files returned from platform API list call
 */
export async function upsertFilesFromCrawl(
  platform: Platform,
  accountId: string,
  folderId: string,
  scannedFiles: IndexedFile[],
): Promise<void> {
  const index = await getIndex();
  const folderKey = composeKey(platform, accountId, folderId);
  const now = Date.now();

  // Build a set of file IDs currently in this folder
  const currentFileIds = new Set(scannedFiles.map((f) => f.id));

  // Ghost cleanup: for each existing entry that claims this folder as a parent
  // but is no longer in the crawl result, remove the folder from its parentFolderIds
  const entriesToDelete: string[] = [];
  for (const [entryKey, entry] of Object.entries(index.entries)) {
    if (entry.parentFolderIds.includes(folderId) && !currentFileIds.has(entry.id)) {
      // File was in this folder before but is no longer there
      entry.parentFolderIds = entry.parentFolderIds.filter((pid) => pid !== folderId);
      if (entry.parentFolderIds.length === 0) {
        // If file has no other parents, remove it entirely
        entriesToDelete.push(entryKey);
      }
    }
  }

  // Delete orphaned entries
  for (const key of entriesToDelete) {
    delete index.entries[key];
  }

  // Upsert new/updated files
  for (const scannedFile of scannedFiles) {
    const fileKey = composeKey(platform, accountId, scannedFile.id);
    const existing = index.entries[fileKey];

    if (existing) {
      // Merge: add folder to parentFolderIds if not already there
      if (!existing.parentFolderIds.includes(folderId)) {
        existing.parentFolderIds.push(folderId);
      }
      // Update metadata (in case file was modified)
      Object.assign(existing, scannedFile);
    } else {
      // New entry
      index.entries[fileKey] = {
        ...scannedFile,
        parentFolderIds: [folderId],
        serverSynced: false,
      };
    }
  }

  // Update crawl state
  index.folderCrawls[folderKey] = {
    crawledAt: now,
    lastAccessedAt: now,
  };

  // Evict LRU entries if approaching storage limit
  await evictIfNeeded(index);

  // Persist updated index
  await storageSet({ metadataIndex: index });
}

/**
 * Mark files as synced to the Orchestrator (serverSynced = true).
 */
export async function markFilesSynced(
  platform: Platform,
  accountId: string,
  fileIds: string[],
): Promise<void> {
  const index = await getIndex();
  for (const fileId of fileIds) {
    const key = composeKey(platform, accountId, fileId);
    if (index.entries[key]) {
      index.entries[key].serverSynced = true;
    }
  }
  await storageSet({ metadataIndex: index });
}

/**
 * Get all files eligible for Orchestrator analysis in a folder.
 * Returns entries whose parentFolderIds includes the folder, for POST to Orchestrator.
 */
export async function getCandidatesForOrchestrator(
  platform: Platform,
  accountId: string,
  folderId: string,
): Promise<IndexedFile[]> {
  const index = await getIndex();
  const prefix = `${platform}:${accountId}:`;
  return Object.entries(index.entries)
    .filter(([key, file]) => key.startsWith(prefix) && file.parentFolderIds.includes(folderId))
    .map(([, file]) => file);
}

/**
 * Get all files in the index for cross-folder comparison.
 * Used by Orchestrator to compare candidates against the full index.
 */
export async function getAllIndexedFiles(
  platform: Platform,
  accountId: string,
): Promise<IndexedFile[]> {
  const index = await getIndex();
  const prefix = `${platform}:${accountId}:`;
  return Object.entries(index.entries)
    .filter(([key, f]) => key.startsWith(prefix) && f.platform === platform)
    .map(([, f]) => f);
}

/**
 * Update folder access time to help LRU eviction prioritize.
 */
export async function touchFolderAccess(
  platform: Platform,
  accountId: string,
  folderId: string,
): Promise<void> {
  const index = await getIndex();
  const folderKey = composeKey(platform, accountId, folderId);
  if (index.folderCrawls[folderKey]) {
    index.folderCrawls[folderKey].lastAccessedAt = Date.now();
    await storageSet({ metadataIndex: index });
  }
}

/**
 * Clear the index (for testing, settings reset, or forced recrawl).
 */
export async function clearIndex(): Promise<void> {
  await storageSet({
    metadataIndex: {
      version: SCHEMA_VERSION,
      entries: {},
      folderCrawls: {},
    },
  });
}

/**
 * Evict LRU folder crawl entries if index is approaching storage limit.
 * Removes entire folder's worth of entries (all files with that folder as parent).
 */
async function evictIfNeeded(index: MetadataIndex): Promise<void> {
  // Rough estimate of serialized size
  const estimatedSize =
    JSON.stringify(index).length +
    (Object.keys(index.entries).length * 50 + // Approximate per-entry overhead
      Object.keys(index.folderCrawls).length * 30);

  if (estimatedSize < STORAGE_SIZE_LIMIT) {
    return; // Not full yet
  }

  // Find the least-recently-accessed folder
  let lruFolderKey: string | null = null;
  let oldestAccessTime = Infinity;

  for (const [key, crawlState] of Object.entries(index.folderCrawls)) {
    if (crawlState.lastAccessedAt < oldestAccessTime) {
      oldestAccessTime = crawlState.lastAccessedAt;
      lruFolderKey = key;
    }
  }

  if (!lruFolderKey) return; // No folders to evict

  // Extract folder ID from key (format: "platform:accountId:folderId")
  const [, , folderId] = lruFolderKey.split(':');
  if (!folderId) return;

  // Remove all entries that list this folder as a parent
  const entriesToDelete: string[] = [];
  for (const [entryKey, entry] of Object.entries(index.entries)) {
    entry.parentFolderIds = entry.parentFolderIds.filter((pid) => pid !== folderId);
    if (entry.parentFolderIds.length === 0) {
      entriesToDelete.push(entryKey);
    }
  }

  for (const key of entriesToDelete) {
    delete index.entries[key];
  }

  // Remove the folder crawl record
  delete index.folderCrawls[lruFolderKey];
}

/**
 * Get index statistics (useful for debugging and monitoring).
 */
export async function getIndexStats(): Promise<{
  version: number;
  totalFiles: number;
  totalFolders: number;
  estimatedSizeBytes: number;
}> {
  const index = await getIndex();
  return {
    version: index.version,
    totalFiles: Object.keys(index.entries).length,
    totalFolders: Object.keys(index.folderCrawls).length,
    estimatedSizeBytes: JSON.stringify(index).length,
  };
}
