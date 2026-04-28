/**
 * Return type for executor functions.
 * Collects undo metadata for a single action or action group.
 */
export interface UndoEntry {
  action: string;
  platform: "google_drive" | "notion";
  actionDetails: Record<string, unknown>;
  undoPayload: Record<string, unknown>;
  actionGroupId?: string;
  actionGroupStep?: number;
  expiresAt?: Date;
}

/**
 * Platform context for executor functions.
 * Encodes which platform adapter to dispatch to.
 */
export interface PlatformContext {
  userId: string;
  accountId: string;
  platform: "google_drive" | "notion";
}
