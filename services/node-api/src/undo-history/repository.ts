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
  undoneAt: string | null;
  createdAt: string;
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
  undone_at: string | null;
  created_at: string;
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
    undoneAt: row.undone_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLS = `
  id, user_id, suggestion_id, action, platform, action_details, undo_payload,
  executed_at, undone_at, created_at
`;

export interface StoreUndoActionInput {
  suggestionId?: string | null;
  action: string;
  platform: "google_drive" | "notion";
  actionDetails: Record<string, unknown>;
  undoPayload: Record<string, unknown>;
}

export async function storeUndoAction(
  userId: string,
  input: StoreUndoActionInput,
): Promise<UndoAction> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<UndoHistoryRow>(
      `insert into public.undo_history
        (user_id, suggestion_id, action, platform, action_details, undo_payload)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       returning ${SELECT_COLS}`,
      [
        userId,
        input.suggestionId ?? null,
        input.action,
        input.platform,
        JSON.stringify(input.actionDetails),
        JSON.stringify(input.undoPayload),
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
    conditions.push("undone_at is null");
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
  undoneAt?: string;
}

export async function markUndone(
  userId: string,
  id: string,
  input: MarkUndoneInput = {},
): Promise<UndoAction | null> {
  return withUserTransaction(userId, async (client) => {
    const undoneAt = input.undoneAt ?? new Date().toISOString();

    const result = await client.query<UndoHistoryRow>(
      `update public.undo_history
       set undone_at = $3::timestamptz
       where user_id = $1 and id = $2
       returning ${SELECT_COLS}`,
      [userId, id, undoneAt],
    );

    if (result.rowCount === 0) return null;
    return rowToAction(result.rows[0]);
  });
}
