import { withUserTransaction } from "../db/withUserTransaction.js";
import type { SuggestionCard } from "./types.js";

export type SuggestionStatus = "pending" | "confirmed" | "skipped" | "dismissed";

export interface StoredSuggestion extends SuggestionCard {
  userId: string;
  platform: "google_drive" | "notion";
  status: SuggestionStatus;
  reason: string | null;
  dismissedForever: boolean;
  confirmedAt: string | null;
  skippedAt: string | null;
  dismissedAt: string | null;
  updatedAt: string;
}

interface SuggestionRow {
  id: string;
  user_id: string;
  platform: "google_drive" | "notion";
  action: SuggestionCard["action"];
  status: SuggestionStatus;
  title: string;
  description: string;
  reason: string | null;
  files: { id: string }[];
  confidence: SuggestionCard["confidence"];
  analysis: Record<string, unknown>;
  dismissed_forever: boolean;
  confirmed_at: string | null;
  skipped_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToStored(row: SuggestionRow): StoredSuggestion {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    action: row.action,
    status: row.status,
    title: row.title,
    description: row.description,
    confidence: row.confidence ?? "medium",
    reason: row.reason,
    fileIds: (row.files ?? []).map((f) => f.id),
    dismissedForever: row.dismissed_forever,
    confirmedAt: row.confirmed_at,
    skippedAt: row.skipped_at,
    dismissedAt: row.dismissed_at,
    generatedAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = `
  id, user_id, platform, action, status, title, description, reason,
  files, analysis->>'confidence' as confidence,
  dismissed_forever, confirmed_at, skipped_at, dismissed_at, created_at, updated_at
`;

export interface ReceiveSuggestionInput {
  platform: "google_drive" | "notion";
  action: SuggestionCard["action"];
  title: string;
  description: string;
  confidence: SuggestionCard["confidence"];
  fileIds: string[];
  reason?: string;
}

export async function storeSuggestion(
  userId: string,
  input: ReceiveSuggestionInput,
): Promise<StoredSuggestion> {
  return withUserTransaction(userId, async (client) => {
    const files = input.fileIds.map((id) => ({ id }));
    const analysis = { confidence: input.confidence };
    const result = await client.query<SuggestionRow>(
      `insert into public.suggestions
        (user_id, platform, action, title, description, reason, files, analysis)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       returning ${SELECT_COLS}`,
      [
        userId,
        input.platform,
        input.action,
        input.title,
        input.description,
        input.reason ?? null,
        JSON.stringify(files),
        JSON.stringify(analysis),
      ],
    );
    return rowToStored(result.rows[0]);
  });
}

export interface ListSuggestionsQuery {
  status?: SuggestionStatus;
  platform?: "google_drive" | "notion";
  limit?: number;
  offset?: number;
}

export async function listSuggestions(
  userId: string,
  query: ListSuggestionsQuery = {},
): Promise<{ suggestions: StoredSuggestion[]; total: number }> {
  const { status, platform, limit = 50, offset = 0 } = query;

  const conditions: string[] = ["user_id = $1", "dismissed_forever = false"];
  const params: unknown[] = [userId];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (platform) {
    params.push(platform);
    conditions.push(`platform = $${params.length}`);
  }

  const where = conditions.join(" and ");

  return withUserTransaction(userId, async (client) => {
    const countResult = await client.query<{ count: string }>(
      `select count(*) from public.suggestions where ${where}`,
      params,
    );

    const dataResult = await client.query<SuggestionRow>(
      `select ${SELECT_COLS}
       from public.suggestions
       where ${where}
       order by created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      suggestions: dataResult.rows.map(rowToStored),
      total: parseInt(countResult.rows[0].count, 10),
    };
  });
}

export async function getSuggestion(userId: string, id: string): Promise<StoredSuggestion | null> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<SuggestionRow>(
      `select ${SELECT_COLS}
       from public.suggestions
       where user_id = $1 and id = $2
       limit 1`,
      [userId, id],
    );
    if (result.rowCount === 0) return null;
    return rowToStored(result.rows[0]);
  });
}

export interface UpdateStatusInput {
  status: SuggestionStatus;
  dismissedForever?: boolean;
}

export async function updateSuggestionStatus(
  userId: string,
  id: string,
  input: UpdateStatusInput,
): Promise<StoredSuggestion | null> {
  return withUserTransaction(userId, async (client) => {
    const now = new Date().toISOString();
    const dismissedForever =
      input.status === "dismissed" ? (input.dismissedForever ?? false) : false;

    const result = await client.query<SuggestionRow>(
      `update public.suggestions
       set
         status = $3,
         dismissed_forever = case when $3 = 'dismissed' then $4 else false end,
         confirmed_at = case when $3 = 'confirmed' then $5::timestamptz else null end,
         skipped_at   = case when $3 = 'skipped' then $5::timestamptz else null end,
         dismissed_at = case when $3 = 'dismissed' then $5::timestamptz else null end
       where user_id = $1 and id = $2
       returning ${SELECT_COLS}`,
      [userId, id, input.status, dismissedForever, now],
    );

    if (result.rowCount === 0) return null;
    return rowToStored(result.rows[0]);
  });
}
