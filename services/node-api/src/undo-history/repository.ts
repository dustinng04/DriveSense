import { withUserTransaction } from "../db/withUserTransaction.js";

export interface UndoAction {
  id: string;
  userId: string;
  suggestionId: string | null;
  action: string;
  platform: "google_drive" | "notion";
  actionDetails: Record<string, unknown>;
  undoPayload: Record<string, unknown>;
  executedAt: string;
  undoStatus: "available" | "expired" | "failed" | "done";
  undoError?: string;
  createdAt: string;
  accountId?: string;
  actionGroupId?: string;
  actionGroupStep?: number;
  expiresAt?: string;
}

interface UndoHistoryRow {
  id: string;
  user_id: string;
  suggestion_id: string | null;
  action: string;
  platform: "google_drive" | "notion";
  action_details: Record<string, unknown>;
  undo_payload: Record<string, unknown>;
  executed_at: string;
  undo_status: "available" | "expired" | "failed" | "done";
  undo_error?: string;
  created_at: string;
  account_id?: string;
  action_group_id?: string;
  action_group_step?: number;
  expires_at?: string;
}

function rowToAction(row: UndoHistoryRow): UndoAction {
  return {
    id: row.id,
    userId: row.user_id,
    suggestionId: row.suggestion_id,
    action: row.action,
    platform: row.platform,
    actionDetails: row.action_details,
    undoPayload: row.undo_payload,
    executedAt: row.executed_at,
    undoStatus: row.undo_status,
    undoError: row.undo_error,
    createdAt: row.created_at,
    accountId: row.account_id,
    actionGroupId: row.action_group_id,
    actionGroupStep: row.action_group_step,
    expiresAt: row.expires_at,
  };
}

const SELECT_COLS = `
  id, user_id, suggestion_id, action, platform, action_details, undo_payload,
  executed_at, undo_status, undo_error, created_at, account_id, 
  action_group_id, action_group_step, expires_at
`;

export interface StoreUndoActionInput {
  suggestionId?: string | null;
  action: string;
  platform: "google_drive" | "notion";
  actionDetails: Record<string, unknown>;
  undoPayload: Record<string, unknown>;
  accountId?: string;
  actionGroupId?: string;
  actionGroupStep?: number;
  expiresAt?: Date;
}

export async function storeUndoAction(
  userId: string,
  input: StoreUndoActionInput,
): Promise<UndoAction> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<UndoHistoryRow>(
      `insert into public.undo_history
        (user_id, suggestion_id, action, platform, action_details, undo_payload,
         account_id, action_group_id, action_group_step, expires_at)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
       returning ${SELECT_COLS}`,
      [
        userId,
        input.suggestionId ?? null,
        input.action,
        input.platform,
        JSON.stringify(input.actionDetails),
        JSON.stringify(input.undoPayload),
        input.accountId ?? null,
        input.actionGroupId ?? null,
        input.actionGroupStep ?? null,
        input.expiresAt ?? null,
      ],
    );
    return rowToAction(result.rows[0]);
  });
}

export interface ListUndoHistoryQuery {
  limit?: number;
  offset?: number;
  includeUndone?: boolean;
}

export async function listUndoHistory(
  userId: string,
  query: ListUndoHistoryQuery = {},
): Promise<{ actions: UndoAction[]; total: number }> {
  const { limit = 50, offset = 0, includeUndone = false } = query;

  const conditions: string[] = ["user_id = $1"];
  const params: unknown[] = [userId];

  if (!includeUndone) {
    conditions.push("undo_status = 'available'");
  }

  const where = conditions.join(" and ");

  return withUserTransaction(userId, async (client) => {
    const countResult = await client.query<{ count: string }>(
      `select count(*) from public.undo_history where ${where}`,
      params,
    );

    const dataResult = await client.query<UndoHistoryRow>(
      `select ${SELECT_COLS}
       from public.undo_history
       where ${where}
       order by executed_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      actions: dataResult.rows.map(rowToAction),
      total: parseInt(countResult.rows[0].count, 10),
    };
  });
}

export async function getUndoAction(
  userId: string,
  id: string,
): Promise<UndoAction | null> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<UndoHistoryRow>(
      `select ${SELECT_COLS}
       from public.undo_history
       where user_id = $1 and id = $2
       limit 1`,
      [userId, id],
    );
    if (result.rowCount === 0) return null;
    return rowToAction(result.rows[0]);
  });
}

export interface MarkUndoneInput {
  undoStatus?: "done" | "failed";
  undoError?: string;
}

export async function markUndone(
  userId: string,
  id: string,
  input: MarkUndoneInput = {},
): Promise<UndoAction | null> {
  return withUserTransaction(userId, async (client) => {
    const undoStatus = input.undoStatus ?? "done";

    const result = await client.query<UndoHistoryRow>(
      `update public.undo_history
       set undo_status = $3, undo_error = $4
       where user_id = $1 and id = $2
       returning ${SELECT_COLS}`,
      [userId, id, undoStatus, input.undoError ?? null],
    );

    if (result.rowCount === 0) return null;
    return rowToAction(result.rows[0]);
  });
}

export async function getUndoGroupByIdOrGroupId(
  userId: string,
  idOrGroupId: string,
): Promise<UndoAction[]> {
  return withUserTransaction(userId, async (client) => {
    // First, try to find by action_group_id
    let result = await client.query<UndoHistoryRow>(
      `select ${SELECT_COLS}
       from public.undo_history
       where user_id = $1 and action_group_id = $2
       order by action_group_step asc`,
      [userId, idOrGroupId],
    );

    if ((result.rowCount ?? 0) > 0) {
      return result.rows.map(rowToAction);
    }

    // Otherwise, try to find by entry id
    result = await client.query<UndoHistoryRow>(
      `select ${SELECT_COLS}
       from public.undo_history
       where user_id = $1 and id = $2`,
      [userId, idOrGroupId],
    );

    if ((result.rowCount ?? 0) === 0) return [];
    return [rowToAction(result.rows[0])];
  });
}
