import type { Platform } from '../context/types.js';
import type { DetectedContext } from '../context/types.js';

export type { Platform, DetectedContext };

/**
 * Lightweight metadata for a single scanned file or page.
 * Content is never read — only metadata exposed by the platform API.
 */
export interface ScannedFile {
  /** Platform-native resource ID */
  id: string;
  /** Display name / title */
  name: string;
  /** MIME type (e.g. "application/vnd.google-apps.document", "text/plain") */
  mimeType: string;
  /** ISO 8601 last-modified timestamp */
  modifiedAt: string;
  /** ISO 8601 creation timestamp, when available */
  createdAt?: string;
  /** File size in bytes, when available (may be absent for Google Docs native formats) */
  sizeBytes?: number;
  /** Human-readable path or breadcrumb, when available */
  path?: string;
  /** Owner email(s) or display names, when available */
  owners?: string[];
  /** Platform this file came from */
  platform: Platform;
  /** Parent folder IDs (Drive) or parent page IDs (Notion) this file belongs to */
  parentFolderIds?: string[];
}

/**
 * File metadata as stored in the browser-local index.
 * Extends ScannedFile with extension-specific tracking fields.
 */
export interface IndexedFile extends ScannedFile {
  /** Parent folder/page IDs this file was found in; enables multi-folder tracking */
  parentFolderIds: string[];
  /** True if this file's metadata has been pushed to Orchestrator and acknowledged */
  serverSynced: boolean;
}

/**
 * Result returned by the FileScanner for a single context.
 */
export interface ScanResult {
  /** The context that was scanned */
  context: DetectedContext;
  /** Files found in the context (empty when skipped) */
  files: ScannedFile[];
  /** ISO 8601 timestamp when the scan ran */
  scannedAt: string;
  /** Whether the blacklist was evaluated */
  blacklistChecked: boolean;
  /** True when the scan was skipped (e.g. folder not whitelisted) */
  skipped: boolean;
  /** Human-readable reason for skipping, when applicable */
  skipReason?: string;
}

/**
 * Options passed to every scan call.
 */
export interface ScanOptions {
  /**
   * Folder IDs or path segments that are blacklisted from scanning.
   * An empty array means everything is permitted.
   */
  blacklistedFolderIds: string[];
  /** Maximum number of files to return per scan (default: 100) */
  maxFiles?: number;
}

/**
 * Platform adapter for file scanning operations.
 * Each platform (Drive, Notion, …) implements listFiles for the FileScanner.
 */
export interface PlatformScanAdapter {
  /** Platform this adapter handles */
  platform: Platform;

  /**
   * Fetch lightweight file metadata for the given resource (folder/page/database).
   * @param userId     - DriveSense user ID
   * @param accountId  - Platform-native account ID (e.g. Google sub, Notion workspace/bot ID)
   * @param resourceId - Drive folder ID, Notion database/page ID, etc.
   * @param maxFiles   - Upper bound on how many items to return
   * @returns Normalized metadata for files found in the resource
   */
  listFiles(
    userId: string,
    accountId: string,
    resourceId: string,
    maxFiles: number
  ): Promise<ScannedFile[]>;
}

/**
 * Platform adapter for content extraction.
 * Each platform (Drive, Notion, …) implements fetchTextContent for similarity analysis.
 */
export interface PlatformContentAdapter {
  /** Platform this adapter handles */
  platform: Platform;

  /**
   * Fetch text content for similarity analysis.
   * Returns markdown/plain text for documents.
   * Should return null for unsupported types (e.g. Google Sheets).
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param fileId    - Platform file ID
   * @param mimeType  - File's MIME type (to skip unsupported types early)
   * @returns Plain text/markdown content, or null if unsupported
   */
  fetchTextContent(
    userId: string,
    accountId: string,
    fileId: string,
    mimeType: string
  ): Promise<string | null>;
}

export interface ContentUpdate {
  old_str: string;
  new_str: string;
  replace_all_matches?: boolean;
}

export interface EditPatch {
  version: 1;
  content_updates: ContentUpdate[];
}

/**
 * Platform adapter for file management operations (execution & undo).
 * Each platform (Drive, Notion, …) implements these for suggestion execution.
 * Divides responsibilities: Service handles API calls → Adapter handles execution logic & undo payload construction.
 */
export interface PlatformExecutionAdapter {
  /** Platform this adapter handles */
  platform: Platform;

  // ============================================================
  // METADATA OPERATIONS
  // ============================================================

  /**
   * Read detailed metadata for a single file.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param fileId    - Platform file ID
   * @returns Normalized file metadata, null if not found
   */
  getFileMetadata(
    userId: string,
    accountId: string,
    fileId: string
  ): Promise<ScannedFile | null>;

  /**
   * Read text content for a file.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param fileId    - Platform file ID
   * @returns File content as plain text, null if unsupported/not found
   */
  getFileContent(
    userId: string,
    accountId: string,
    fileId: string
  ): Promise<string | null>;

  // ============================================================
  // EXECUTION OPERATIONS (from plan)
  // ============================================================

  /**
   * Execute archive action: trash/archive a file.
   * Returns undo payload for reversal.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param fileId    - Platform file ID
   * @returns Undo payload needed to reverse this action
   */
  executeArchive(
    userId: string,
    accountId: string,
    fileId: string
  ): Promise<Record<string, unknown>>;

  /**
   * Execute rename action: rename a file.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param fileId    - Platform file ID
   * @param newName   - New file name
   * @returns Undo payload (old name, etc.)
   */
  executeRename(
    userId: string,
    accountId: string,
    fileId: string,
    newName: string
  ): Promise<Record<string, unknown>>;

  /**
   * Execute merge action: append source content to survivor, then archive source.
   * @param userId       - DriveSense user ID
   * @param accountId    - Platform account ID
   * @param survivorId   - File to merge into
   * @param sourceId     - File to merge from (will be archived)
   * @returns Array of undo payloads (one per step, with action_group_id if multi-step)
   */
  executeMerge(
    userId: string,
    accountId: string,
    survivorId: string,
    sourceId: string
  ): Promise<Array<{ payload: Record<string, unknown>; step?: number }>>;

  /**
   * Execute edit action: update file content.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param fileId    - Platform file ID
   * @param editPatch - Ordered literal content update operations
   * @returns Undo payload (revision id, old content, etc.)
   */
  executeEdit(
    userId: string,
    accountId: string,
    fileId: string,
    editPatch: EditPatch
  ): Promise<Record<string, unknown>>;

  // ============================================================
  // UNDO OPERATIONS (from plan)
  // ============================================================

  /**
   * Undo an archive action: restore/untrash a file.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param undoPayload - Payload from executeArchive (fileId, etc.)
   * @returns true if successful
   */
  undoArchive(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>
  ): Promise<boolean>;

  /**
   * Undo a rename action: restore original name.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param undoPayload - Payload from executeRename (fileId, oldName)
   * @returns true if successful
   */
  undoRename(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>
  ): Promise<boolean>;

  /**
   * Undo a merge action: restore survivor content snapshot, restore source.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param undoPayload - Payload from executeMerge (step-specific)
   * @param step      - Step number (1=append, 2=archive)
   * @returns true if successful
   */
  undoMerge(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>,
    step?: number
  ): Promise<boolean>;

  /**
   * Undo an edit action: restore previous content/revision.
   * @param userId    - DriveSense user ID
   * @param accountId - Platform account ID
   * @param undoPayload - Payload from executeEdit (revisionId, old blocks, etc.)
   * @returns true if successful
   */
  undoEdit(
    userId: string,
    accountId: string,
    undoPayload: Record<string, unknown>
  ): Promise<boolean>;
}
