/**
 * Suggestion Executor — High-level orchestration of suggestion execution.
 * Delegates to platform adapters (Google Drive, Notion) for actual execution.
 *
 * This module:
 * - Validates suggestion pre-conditions
 * - Delegates to appropriate platform adapter
 * - Collects undo metadata from adapters
 * - Handles multi-step action grouping
 *
 * The executor does NOT write to the DB — the route handler wraps everything in a transaction.
 */

import { GoogleDriveExecutionAdapter } from "../google-drive/adapter.js";
import { NotionExecutionAdapter } from "../notion/adapter.js";
import type { EditPatch } from "../scanner/types.js";
import { PlatformContext, UndoEntry } from "./executor.types.js";
// ============================================================================
// Errors
// ============================================================================

export class CompensationError extends Error {
  constructor(
    message: string,
    public originalError: Error,
    public compensationError: Error,
  ) {
    super(message);
    this.name = "CompensationError";
  }
}

// ============================================================================
// Adapter Factory
// ============================================================================

function getExecutionAdapter(platform: "google_drive" | "notion") {
  if (platform === "google_drive") {
    return new GoogleDriveExecutionAdapter();
  }
  return new NotionExecutionAdapter();
}

// ============================================================================
// ARCHIVE Executor
// ============================================================================

export async function executeArchive(
  ctx: PlatformContext,
  fileId: string,
): Promise<UndoEntry[]> {
  const adapter = getExecutionAdapter(ctx.platform);
  const undoPayload = await adapter.executeArchive(ctx.userId, ctx.accountId, fileId);

  return [
    {
      action: "archive",
      platform: ctx.platform,
      actionDetails: { fileId },
      undoPayload,
      expiresAt:
        ctx.platform === "google_drive"
          ? new Date(Date.now() + 29 * 24 * 60 * 60 * 1000) // 29 days for Drive trash
          : undefined, // Notion archive is indefinite
    },
  ];
}

// ============================================================================
// RENAME Executor
// ============================================================================

export async function executeRename(
  ctx: PlatformContext,
  fileId: string,
  newName: string,
): Promise<UndoEntry[]> {
  const adapter = getExecutionAdapter(ctx.platform);
  const undoPayload = await adapter.executeRename(ctx.userId, ctx.accountId, fileId, newName);

  return [
    {
      action: "rename",
      platform: ctx.platform,
      actionDetails: { fileId, newName },
      undoPayload,
    },
  ];
}

// ============================================================================
// MERGE Executor
// ============================================================================

export async function executeMerge(
  ctx: PlatformContext,
  survivorFileId: string,
  sourceFileId: string,
): Promise<UndoEntry[]> {
  const adapter = getExecutionAdapter(ctx.platform);
  const mergeUndoPayloads = await adapter.executeMerge(
    ctx.userId,
    ctx.accountId,
    survivorFileId,
    sourceFileId,
  );

  // Group multiple steps under one action_group_id
  const groupId = crypto.randomUUID();

  return mergeUndoPayloads.map((item, idx) => ({
    action: "merge",
    platform: ctx.platform,
    actionDetails: {
      survivorFileId,
      sourceFileId,
      step: item.step ?? idx + 1,
    },
    undoPayload: item.payload,
    actionGroupId: groupId,
    actionGroupStep: item.step ?? idx + 1,
    expiresAt:
      ctx.platform === "google_drive" && (item.step ?? idx + 1) === 2
        ? new Date(Date.now() + 29 * 24 * 60 * 60 * 1000)
        : undefined,
  }));
}

// ============================================================================
// EDIT Executor
// ============================================================================

export async function executeEdit(
  ctx: PlatformContext,
  fileId: string,
  editPatch: EditPatch,
): Promise<UndoEntry[]> {
  const adapter = getExecutionAdapter(ctx.platform);
  const undoPayload = await adapter.executeEdit(ctx.userId, ctx.accountId, fileId, editPatch);

  return [
    {
      action: "edit",
      platform: ctx.platform,
      actionDetails: { fileId, updateCount: editPatch.content_updates.length },
      undoPayload,
    },
  ];
}

export async function executeUndo(
  ctx: PlatformContext,
  action: string,
  undoPayload: Record<string, unknown>,
  step?: number,
): Promise<boolean> {
  const adapter = getExecutionAdapter(ctx.platform);

  if (action === "archive") {
    return adapter.undoArchive(ctx.userId, ctx.accountId, undoPayload);
  }
  if (action === "rename") {
    return adapter.undoRename(ctx.userId, ctx.accountId, undoPayload);
  }
  if (action === "merge") {
    return adapter.undoMerge(ctx.userId, ctx.accountId, undoPayload, step);
  }
  if (action === "edit") {
    return adapter.undoEdit(ctx.userId, ctx.accountId, undoPayload);
  }

  throw new Error(`Action '${action}' not supported for undo`);
}
