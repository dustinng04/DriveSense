import type {
  DetectedContext,
  PlatformScanAdapter,
  ScanOptions,
  ScanResult,
} from './types.js';

const DEFAULT_MAX_FILES = 100;

/**
 * Lightweight file scanner.
 *
 * Accepts a DetectedContext (produced by the ContextDetector), applies the
 * folder whitelist, then delegates to the appropriate PlatformScanAdapter to
 * fetch file metadata for the current context.
 *
 * Design goals:
 *  - Only metadata is fetched — file content is never read here.
 *  - A folder must be explicitly whitelisted before it is scanned.
 *  - Platform adapters are injected, making the scanner easy to stub in tests
 *    and straightforward to extend for new platforms.
 */
export class FileScanner {
  private adapters: Map<string, PlatformScanAdapter> = new Map();

  constructor(adapters: PlatformScanAdapter[] = []) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.platform, adapter);
    }
  }

  /** Register (or replace) an adapter for a platform */
  registerAdapter(adapter: PlatformScanAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  /**
   * Scan the current context.
   *
   * Skips immediately when:
   *  - The platform is unknown
   *  - No adapter is registered for the platform
   *  - The resource is not a folder/page
   *  - The resource ID is not in the whitelist
   */
  async scan(
    userId: string,
    accountId: string,
    context: DetectedContext,
    options: ScanOptions,
  ): Promise<ScanResult> {
    const scannedAt = new Date().toISOString();
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

    const skip = (skipReason: string): ScanResult => ({
      context,
      files: [],
      scannedAt,
      whitelistChecked: false,
      skipped: true,
      skipReason,
    });

    if (context.platform === 'unknown') {
      return skip('Platform could not be detected from the current URL.');
    }

    if (!this.adapters.has(context.platform)) {
      return skip(`No scan adapter registered for platform "${context.platform}".`);
    }

    if (context.resourceId === null) {
      return skip('No resource ID available for the current context.');
    }

    // Whitelist check — the resource ID must appear in the whitelist.
    // An empty whitelist means nothing is permitted.
    const isWhitelisted = options.whitelistedFolderIds.includes(context.resourceId);

    if (!isWhitelisted) {
      return {
        context,
        files: [],
        scannedAt,
        whitelistChecked: true,
        skipped: true,
        skipReason: `Resource "${context.resourceId}" is not in the whitelist. Add it to Settings → Whitelisted Folders before scanning.`,
      };
    }

    const adapter = this.adapters.get(context.platform)!;
    const files = await adapter.listFiles(userId, accountId, context.resourceId, maxFiles);

    return {
      context,
      files,
      scannedAt,
      whitelistChecked: true,
      skipped: false,
    };
  }
}
