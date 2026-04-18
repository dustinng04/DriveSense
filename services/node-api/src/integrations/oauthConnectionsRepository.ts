import { withUserTransaction } from "../db/withUserTransaction.js";

interface OAuthConnectionRow {
  user_id: string;
  provider: OAuthProvider;
  account_id: string;
  is_primary: boolean;
  access_token: string;
  refresh_token: string | null;
  token_scope: string | null;
  token_type: string | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
}

export type OAuthProvider = "google_drive" | "notion";

export interface OAuthConnection {
  userId: string;
  provider: OAuthProvider;
  accountId: string;
  isPrimary: boolean;
  accessToken: string;
  refreshToken: string | null;
  tokenScope: string | null;
  tokenType: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthTokenWriteInput {
  accessToken: string;
  refreshToken: string | null;
  tokenScope: string | null;
  tokenType: string | null;
  expiryDate: string | null;
  accountId: string;
  /** When omitted, first connection for this provider becomes primary; otherwise false unless set */
  isPrimary?: boolean;
}

export interface OAuthAccountSummary {
  provider: OAuthProvider;
  accountId: string;
  isPrimary: boolean;
}

export interface LinkedAccountsPayload {
  google_drive: string[];
  notion: string[];
}

function rowToConnection(row: OAuthConnectionRow): OAuthConnection {
  return {
    userId: row.user_id,
    provider: row.provider,
    accountId: row.account_id,
    isPrimary: row.is_primary,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenScope: row.token_scope,
    tokenType: row.token_type,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOAuthConnection(
  userId: string,
  provider: OAuthProvider,
  accountId: string,
): Promise<OAuthConnection | null> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<OAuthConnectionRow>(
      `select
        user_id,
        provider,
        account_id,
        is_primary,
        access_token,
        refresh_token,
        token_scope,
        token_type,
        expiry_date,
        created_at,
        updated_at
       from public.oauth_connections
       where user_id = $1 and provider = $2 and account_id = $3`,
      [userId, provider, accountId],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return rowToConnection(result.rows[0]!);
  });
}

async function countConnectionsForProvider(
  userId: string,
  provider: OAuthProvider,
): Promise<number> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<{ n: string }>(
      `select count(*)::text as n from public.oauth_connections
       where user_id = $1 and provider = $2`,
      [userId, provider],
    );
    return Number(result.rows[0]?.n ?? 0);
  });
}

export async function upsertOAuthConnection(
  userId: string,
  provider: OAuthProvider,
  input: OAuthTokenWriteInput,
): Promise<OAuthConnection> {
  const existingCount = await countConnectionsForProvider(userId, provider);
  const isPrimary =
    input.isPrimary !== undefined ? input.isPrimary : existingCount === 0;

  return withUserTransaction(userId, async (client) => {
    const result = await client.query<OAuthConnectionRow>(
      `insert into public.oauth_connections (
        user_id,
        provider,
        account_id,
        is_primary,
        access_token,
        refresh_token,
        token_scope,
        token_type,
        expiry_date
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
      on conflict (user_id, provider, account_id) do update
      set
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_scope = excluded.token_scope,
        token_type = excluded.token_type,
        expiry_date = excluded.expiry_date
      returning
        user_id,
        provider,
        account_id,
        is_primary,
        access_token,
        refresh_token,
        token_scope,
        token_type,
        expiry_date,
        created_at,
        updated_at`,
      [
        userId,
        provider,
        input.accountId,
        isPrimary,
        input.accessToken,
        input.refreshToken,
        input.tokenScope,
        input.tokenType,
        input.expiryDate,
      ],
    );

    return rowToConnection(result.rows[0]!);
  });
}

export async function deleteOAuthConnection(
  userId: string,
  provider: OAuthProvider,
  accountId: string,
): Promise<void> {
  await withUserTransaction(userId, async (client) => {
    await client.query(
      "delete from public.oauth_connections where user_id = $1 and provider = $2 and account_id = $3",
      [userId, provider, accountId],
    );
  });
}

/** Non-secret summaries for status UI and JWT enrichment */
export async function listOAuthAccountSummaries(
  userId: string,
  provider?: OAuthProvider,
): Promise<OAuthAccountSummary[]> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<{
      provider: OAuthProvider;
      account_id: string;
      is_primary: boolean;
    }>(
      provider
        ? `select provider, account_id, is_primary from public.oauth_connections
           where user_id = $1 and provider = $2
           order by is_primary desc, updated_at desc`
        : `select provider, account_id, is_primary from public.oauth_connections
           where user_id = $1
           order by provider, is_primary desc, updated_at desc`,
      provider ? [userId, provider] : [userId],
    );
    return result.rows.map((row) => ({
      provider: row.provider,
      accountId: row.account_id,
      isPrimary: row.is_primary,
    }));
  });
}

export async function getLinkedAccountsPayload(userId: string): Promise<LinkedAccountsPayload> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<{ provider: OAuthProvider; account_id: string }>(
      `select provider, account_id from public.oauth_connections where user_id = $1`,
      [userId],
    );
    const payload: LinkedAccountsPayload = { google_drive: [], notion: [] };
    for (const row of result.rows) {
      payload[row.provider].push(row.account_id);
    }
    return payload;
  });
}
