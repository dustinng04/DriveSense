import { withUserTransaction } from "../db/withUserTransaction.js";
import type { SuggestionCard } from "./types.js";

const ACTIVE_SUGGESTION_DEDUPE_WINDOW_HOURS = 24;

export type SuggestionStatus =
  | "pending_enrichment"
  | "pending"
  | "confirmed"
  | "skipped"
  | "dismissed";

export interface StoredSuggestion extends SuggestionCard {
  userId: string;
  platform: "google_drive" | "notion";
  accountId: string | null;
  status: SuggestionStatus;
  reason: string | null;
  confirmedAt: string | null;
  analysis?: Record<string, unknown>;
  updatedAt: string;
}

interface SuggestionRow {
  id: string;
  user_id: string;
  platform: "google_drive" | "notion";
  account_id: string | null;
  action: SuggestionCard["action"];
  status: SuggestionStatus;
  title: string;
  description: string;
  reason: string | null;
  files: { id: string }[];
  confidence: SuggestionCard["confidence"];
  analysis: Record<string, unknown>;
  dismissed_count: number;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToStored(row: SuggestionRow): StoredSuggestion {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    accountId: row.account_id,
    action: row.action,
    status: row.status,
    title: row.title,
    description: row.description,
    confidence: row.confidence ?? "medium",
    reason: row.reason,
    fileIds: (row.files ?? []).map((f) => f.id),
    dismissedCount: row.dismissed_count,
    confirmedAt: row.confirmed_at,
    generatedAt: row.created_at,
    analysis: row.analysis ?? undefined,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = `
  id, user_id, platform, account_id, action, status, title, description, reason,
  files, analysis->>'confidence' as confidence,
  dismissed_count, confirmed_at, created_at, updated_at
`;

export interface ReceiveSuggestionInput {
  platform: "google_drive" | "notion";
  accountId?: string;
  action: SuggestionCard["action"];
  status?: SuggestionStatus;
  title: string;
  description: string;
  confidence: SuggestionCard["confidence"];
  fileIds: string[];
  reason?: string;
  analysis?: Record<string, unknown>;
}

function normalizeSuggestionFileIds(action: SuggestionCard["action"], fileIds: string[]): string[] {
  if (action === "edit") {
    return [...fileIds];
  }
  return [...fileIds].sort();
}

function getAnalysisObject(value: ReceiveSuggestionInput["analysis"]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function getEditDedupeFiles(input: ReceiveSuggestionInput): { targetId: string; referenceId: string } | null {
  const analysis = getAnalysisObject(input.analysis);
  const files = analysis.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return null;
  }

  const fileMap = files as Record<string, unknown>;
  const targetId =
    fileMap.target && typeof fileMap.target === "object" && !Array.isArray(fileMap.target)
      ? (fileMap.target as { id?: unknown }).id
      : undefined;
  const referenceId =
    fileMap.reference && typeof fileMap.reference === "object" && !Array.isArray(fileMap.reference)
      ? (fileMap.reference as { id?: unknown }).id
      : undefined;

  if (typeof targetId !== "string" || typeof referenceId !== "string") {
    return null;
  }

  return { targetId, referenceId };
}

function buildSuggestionLockKey(input: ReceiveSuggestionInput): string {
  if (input.action === "edit") {
    const editFiles = getEditDedupeFiles(input);
    if (editFiles) {
      return `${editFiles.targetId}:${editFiles.referenceId}`;
    }
  }

  return normalizeSuggestionFileIds(input.action, input.fileIds).join(":");
}

export async function storeSuggestion(
  userId: string,
  accountId: string,
  input: ReceiveSuggestionInput,
): Promise<StoredSuggestion> {
  return withUserTransaction(userId, async (client) => {
    const files = input.fileIds.map((id) => ({ id }));
    const analysis = { confidence: input.confidence, ...getAnalysisObject(input.analysis) };
    const advisoryLockKey = `${userId}:${input.platform}:${accountId}:${input.action}:${buildSuggestionLockKey(input)}`;

    await client.query("select pg_advisory_xact_lock(hashtext($1))", [advisoryLockKey]);

    const normalizedFileFilter = normalizeSuggestionFileIds(input.action, input.fileIds).map((id) => ({ id }));
    const editFiles = input.action === "edit" ? getEditDedupeFiles(input) : null;
    const dedupePredicate = editFiles
      ? "and analysis @> $5::jsonb"
      : "and files @> $5::jsonb and jsonb_array_length(files) = $6";
    const dedupeParams = editFiles
      ? [
          JSON.stringify({
            files: {
              target: { id: editFiles.targetId },
              reference: { id: editFiles.referenceId },
            },
          }),
          ACTIVE_SUGGESTION_DEDUPE_WINDOW_HOURS,
        ]
      : [JSON.stringify(normalizedFileFilter), normalizedFileFilter.length, ACTIVE_SUGGESTION_DEDUPE_WINDOW_HOURS];
    const windowParamIndex = editFiles ? 6 : 7;

    const existingResult = await client.query<SuggestionRow>(
      `select ${SELECT_COLS}
       from public.suggestions
       where user_id = $1
         and platform = $2
         and account_id = $3
         and action = $4
         ${dedupePredicate}
         and status in ('pending_enrichment', 'pending', 'confirmed', 'skipped')
         and created_at >= now() - make_interval(hours => $${windowParamIndex})
       order by created_at desc
       limit 1`,
      [
        userId,
        input.platform,
        accountId,
        input.action,
        ...dedupeParams,
      ],
    );

    if ((existingResult.rowCount ?? 0) > 0) {
      return rowToStored(existingResult.rows[0]);
    }

    const result = await client.query<SuggestionRow>(
      `insert into public.suggestions
        (user_id, platform, account_id, action, status, title, description, reason, files, analysis)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
       returning ${SELECT_COLS}`,
      [
        userId,
        input.platform,
        accountId,
        input.action,
        input.status ?? "pending",
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
  accountId?: string;
  limit?: number;
  offset?: number;
}

export async function listSuggestions(
  userId: string,
  query: ListSuggestionsQuery = {},
): Promise<{ suggestions: StoredSuggestion[]; total: number }> {
  const { status, platform, accountId, limit = 50, offset = 0 } = query;

  const conditions: string[] = ["user_id = $1", "dismissed_count < 3"];
  const params: unknown[] = [userId];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (platform) {
    params.push(platform);
    conditions.push(`platform = $${params.length}`);
  }
  if (accountId) {
    params.push(accountId);
    conditions.push(`account_id = $${params.length}`);
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
}

export interface MarkSuggestionForReviewInput {
  originalAction: Exclude<SuggestionCard["action"], "review">;
  errorMessage: string;
}

export async function updateSuggestionStatus(
  userId: string,
  id: string,
  input: UpdateStatusInput,
): Promise<StoredSuggestion | null> {
  return withUserTransaction(userId, async (client) => {
    const now = new Date().toISOString();

    const result = await client.query<SuggestionRow>(
      `update public.suggestions
       set
         status = $3,
         dismissed_count = case when $3 = 'dismissed' then dismissed_count + 1 else dismissed_count end,
         confirmed_at = case when $3 = 'confirmed' then $4::timestamptz else null end
       where user_id = $1 and id = $2
       returning ${SELECT_COLS}`,
      [userId, id, input.status, now],
    );

    if (result.rowCount === 0) return null;
    return rowToStored(result.rows[0]);
  });
}

export async function markSuggestionForReview(
  userId: string,
  id: string,
  input: MarkSuggestionForReviewInput,
): Promise<StoredSuggestion | null> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<SuggestionRow>(
      `update public.suggestions
       set
         action = 'review',
         status = 'pending',
         confirmed_at = null,
         analysis = analysis || $3::jsonb
       where user_id = $1 and id = $2
       returning ${SELECT_COLS}`,
      [
        userId,
        id,
        JSON.stringify({
          executionFallback: {
            originalAction: input.originalAction,
            failedAt: new Date().toISOString(),
            errorMessage: input.errorMessage,
          },
        }),
      ],
    );

    if (result.rowCount === 0) return null;
    return rowToStored(result.rows[0]);
  });
}

export interface ApplySuggestionEnrichmentInput {
  action?: SuggestionCard["action"];
  title?: string;
  description?: string;
  reason?: string | null;
  confidence?: SuggestionCard["confidence"];
  analysis?: Record<string, unknown>;
}

export async function applySuggestionEnrichment(
  userId: string,
  id: string,
  input: ApplySuggestionEnrichmentInput,
): Promise<StoredSuggestion | null> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<SuggestionRow>(
      `update public.suggestions
       set
         action = coalesce($3, action),
         title = coalesce($4, title),
         description = coalesce($5, description),
         reason = $6,
         analysis = analysis || $7::jsonb,
         status = 'pending'
       where user_id = $1
         and id = $2
         and status = 'pending_enrichment'
       returning ${SELECT_COLS}`,
      [
        userId,
        id,
        input.action ?? null,
        input.title ?? null,
        input.description ?? null,
        input.reason ?? null,
        JSON.stringify({
          ...(input.analysis ?? {}),
          ...(input.confidence ? { confidence: input.confidence } : {}),
        }),
      ],
    );

    if (result.rowCount === 0) return null;
    return rowToStored(result.rows[0]);
  });
}

/**
 * Check if a suggestion for this file + action has been rejected recently.
 * Returns true if the suggestion should be skipped due to rejection cooldown.
 * - dismissed_count = 1 → skip for 7 days
 * - dismissed_count = 2 → skip for 15 days
 * - dismissed_count >= 3 → never suggest again (permanent rejection)
 */
export async function checkRejectionHistory(
  userId: string,
  fileIds: string[],
  action: string,
): Promise<boolean> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<{
      dismissed_count: number;
      updated_at: string;
    }>(
      `select dismissed_count, updated_at
       from public.suggestions
       where user_id = $1
         and action = $2
         and files @> $3::jsonb
         and dismissed_count >= 1
       order by updated_at desc
       limit 1`,
      [userId, action, JSON.stringify(fileIds.map((id) => ({ id })))],
    );

    if (result.rowCount === 0) return false;

    const row = result.rows[0];
    const { dismissed_count, updated_at } = row;

    if (dismissed_count >= 3) return true;

    const lastDismissed = new Date(updated_at);
    const now = new Date();
    const daysSinceDismissed = (now.getTime() - lastDismissed.getTime()) / (1000 * 60 * 60 * 24);

    if (dismissed_count === 1) return daysSinceDismissed < 7;
    if (dismissed_count === 2) return daysSinceDismissed < 15;

    return false;
  });
}
