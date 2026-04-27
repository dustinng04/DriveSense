/**
 * Scanner routes for file analysis and cross-folder duplicate detection.
 * POST /scan/cross-folder — async cross-folder metadata comparison
 */

import { Router, type Request, type Response } from 'express';
import type { AuthenticatedRequestContext } from '../auth/types.js';
import { spawnCrossFolderScan, type CrossFolderScanTask } from './worker.js';
import type { IndexedFileMetadata } from './analysis.js';
import type { Platform, DetectedContext } from '../context/types.js';
import { FileScanner } from './scanner.js';
import { GoogleDriveScanAdapter } from '../google-drive/adapter.js';
import { NotionScanAdapter } from '../notion/adapter.js';
import { getRules, type FolderBlacklistRule } from '../rules/repository.js';

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

const VALID_PLATFORMS: Platform[] = ['google_drive', 'notion'];

function isValidPlatform(v: unknown): v is Platform {
  return VALID_PLATFORMS.includes(v as Platform);
}

function isIndexedFileMetadata(v: unknown): v is IndexedFileMetadata {
  if (typeof v !== 'object' || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.mimeType === 'string' &&
    typeof obj.modifiedAt === 'string' &&
    (obj.createdAt === undefined || typeof obj.createdAt === 'string') &&
    (obj.sizeBytes === undefined || typeof obj.sizeBytes === 'number') &&
    (obj.platform === 'google_drive' || obj.platform === 'notion') &&
    Array.isArray(obj.parentFolderIds) &&
    (obj.parentFolderIds as unknown[]).every((id) => typeof id === 'string')
  );
}

export const scannerRouter = Router();

/**
 * POST /scan/cross-folder
 * 
 * Async cross-folder metadata comparison.
 * 
 * Request body:
 * {
 *   platform: "google_drive" | "notion",
 *   accountId: string,
 *   candidates: IndexedFileMetadata[],    // Files from current folder
 *   universe: IndexedFileMetadata[],      // All other indexed files for this account
 *   llm?: {                                // Optional LLM settings from extension
 *     provider?: string,                   // User's configured LLM provider
 *     hasByokKey?: boolean                 // Whether user has BYOK key for provider
 *   }
 * }
 * 
 * Response: 202 Accepted (async task enqueued)
 * { status: "processing", candidatesCount: number, universeCount: number }
 */
scannerRouter.post(
  '/cross-folder',
  (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    const { platform, accountId, candidates, universe, llm } = req.body ?? {};

    // Validate platform
    if (!isValidPlatform(platform)) {
      return res.status(400).json({
        error: 'Invalid platform. Must be "google_drive" or "notion".',
      });
    }

    // Validate accountId
    if (typeof accountId !== 'string' || !accountId.trim()) {
      return res.status(400).json({ error: 'accountId is required and must be a non-empty string.' });
    }

    // Validate candidates array
    if (!Array.isArray(candidates)) {
      return res.status(400).json({ error: 'candidates must be an array.' });
    }
    if (!candidates.every(isIndexedFileMetadata)) {
      return res.status(400).json({ error: 'All candidates must be valid IndexedFileMetadata.' });
    }

    // Validate universe array
    if (!Array.isArray(universe)) {
      return res.status(400).json({ error: 'universe must be an array.' });
    }
    if (!universe.every(isIndexedFileMetadata)) {
      return res.status(400).json({ error: 'All universe entries must be valid IndexedFileMetadata.' });
    }

    // Validate we have data to analyze
    if (candidates.length === 0) {
      return res.status(400).json({ error: 'candidates array must not be empty.' });
    }

    // Enqueue async processing task (fire and forget)
    const task: CrossFolderScanTask = {
      userId: res.locals.auth.userId,
      platform,
      accountId,
      candidates,
      universe,
      llm: llm ? {
        provider: typeof llm.provider === 'string' ? llm.provider : undefined,
        hasByokKey: typeof llm.hasByokKey === 'boolean' ? llm.hasByokKey : false,
      } : undefined,
    };

    spawnCrossFolderScan(task);

    // Return 202 Accepted immediately
    return res.status(202).json({
      status: 'processing',
      candidatesCount: candidates.length,
      universeCount: universe.length,
    });
  },
);

/**
 * GET /scan/folder/:folderId
 * 
 * Crawl lightweight metadata for up to 100 files in a folder.
 * Skips if the folder is blacklisted in user rules.
 */
scannerRouter.get(
  '/folder/:folderId',
  async (req: Request, res: Response<unknown, AuthenticatedLocals>) => {
    try {
      const folderId = req.params.folderId;
      if (!folderId || typeof folderId !== 'string') {
        return res.status(400).json({ error: 'folderId is required' });
      }

      const platform = req.query.platform;
      const accountId = req.header('X-Platform-Account');

      if (!isValidPlatform(platform)) {
        return res.status(400).json({ error: 'Invalid platform query param' });
      }
      if (!accountId) {
        return res.status(400).json({ error: 'Missing X-Platform-Account header' });
      }

      const userId = res.locals.auth.userId;

      // 1. Get rules to extract blacklist
      const rulesInfo = await getRules(userId);
      const rules = rulesInfo?.rules || [];
      const blacklistedFolderIds = rules
        .filter((r): r is FolderBlacklistRule => r.type === 'folder_blacklist' && r.platform === platform)
        .map((r) => r.path);

      // 2. Initialize scanner
      const scanner = new FileScanner([
        new GoogleDriveScanAdapter(),
        new NotionScanAdapter()
      ]);

      // 3. Scan
      const context: DetectedContext = {
        platform,
        contextType: platform === 'notion' ? 'page' : 'folder',
        resourceId: folderId,
        url: '', // unused for the scan itself
      };

      const result = await scanner.scan(userId, accountId, context, {
        blacklistedFolderIds,
        maxFiles: 100,
      });

      if (result.skipped) {
        return res.status(200).json({
          status: 'skipped',
          reason: result.skipReason,
          files: [],
        });
      }

      return res.status(200).json({
        status: 'success',
        files: result.files,
      });
    } catch (error) {
      console.error('[Scanner Routes] GET /scan/folder failed', error);
      return res.status(500).json({ error: 'Failed to scan folder' });
    }
  }
);
