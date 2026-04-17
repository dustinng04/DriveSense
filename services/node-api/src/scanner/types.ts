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
  /** Whether the whitelist was evaluated */
  whitelistChecked: boolean;
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
   * Folder IDs or path segments that are whitelisted for scanning.
   * An empty array means nothing is whitelisted and all scans are skipped.
   */
  whitelistedFolderIds: string[];
  /** Maximum number of files to return per scan (default: 100) */
  maxFiles?: number;
}

/**
 * Platform-specific adapter that the FileScanner delegates to.
 * Implement one adapter per platform (Drive, Notion, …).
 */
export interface PlatformScanAdapter {
  /** Platform this adapter handles */
  platform: Platform;
  /**
   * Fetch lightweight file metadata for the given resource.
   * @param resourceId - Drive folder ID, Notion database/page ID, etc.
   * @param maxFiles   - Upper bound on how many items to return
   */
  listFiles(resourceId: string, maxFiles: number): Promise<ScannedFile[]>;
}
