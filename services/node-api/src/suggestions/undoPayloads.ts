/**
 * Typed undo payloads for each action/platform combination.
 * These are the backward reconstruction data needed to reverse an executed action.
 */

// ============================================================================
// ARCHIVE — Drive & Notion
// ============================================================================

export interface DriveArchiveUndoPayload {
  fileId: string;
  // Drive untrash restores to original parent automatically.
  // No parent tracking needed unless parent was also deleted.
}

export interface NotionArchiveUndoPayload {
  pageId: string;
  // PATCH { in_trash: false } is sufficient; parent is preserved.
}

// ============================================================================
// RENAME — Drive & Notion
// ============================================================================

export interface DriveRenameUndoPayload {
  fileId: string;
  oldName: string;
}

export interface NotionRenameUndoPayload {
  pageId: string;
  oldTitle: string;
}

// ============================================================================
// MERGE — Drive (two entries, same action_group_id)
// ============================================================================

export interface DriveMergeAppendUndoPayload {
  survivorFileId: string;
  survivorRevisionIdBeforeAppend: string; // pinned with keepForever=true
}

export interface DriveMergeArchiveUndoPayload {
  sourceFileId: string;
  // expires_at = executed_at + 29 days
}

// ============================================================================
// MERGE — Notion (two entries, same action_group_id)
// ============================================================================

export interface NotionMergeAppendUndoPayload {
  survivorPageId: string;
  appendedBlockIds: string[]; // returned by POST /blocks/{survivorId}/children
}

export interface NotionMergeArchiveUndoPayload {
  sourcePageId: string;
  // no expiry — Notion archive is indefinite
}

// ============================================================================
// EDIT — Drive
// ============================================================================

export interface DriveEditUndoPayload {
  fileId: string;
  revisionIdBeforeEdit: string; // pinned with keepForever=true before the write
}

// ============================================================================
// EDIT — Notion
// ============================================================================

export interface NotionEditBlockSnapshot {
  blockId: string;
  beforeContent: unknown; // full block object as returned by GET /blocks/{blockId}
}

export interface NotionEditUndoPayload {
  pageId: string;
  blockSnapshots: NotionEditBlockSnapshot[];
}

// ============================================================================
// Union type for type-safe dispatching
// ============================================================================

export type DriveUndoPayload =
  | DriveArchiveUndoPayload
  | DriveRenameUndoPayload
  | DriveMergeAppendUndoPayload
  | DriveMergeArchiveUndoPayload
  | DriveEditUndoPayload;

export type NotionUndoPayload =
  | NotionArchiveUndoPayload
  | NotionRenameUndoPayload
  | NotionMergeAppendUndoPayload
  | NotionMergeArchiveUndoPayload
  | NotionEditUndoPayload;

export type UndoPayload = DriveUndoPayload | NotionUndoPayload;
