import { withUserTransaction } from "../db/withUserTransaction.js";

interface OAuthConnectionRow {
  user_id: string;
  provider: OAuthProvider;
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
}

function rowToConnection(row: OAuthConnectionRow): OAuthConnection {
  return {
    userId: row.user_id,
    provider: row.provider,
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
): Promise<OAuthConnection | null> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<OAuthConnectionRow>(
      `select
        user_id,
        provider,
        access_token,
        refresh_token,
        token_scope,
        token_type,
        expiry_date,
        created_at,
        updated_at
       from public.oauth_connections
       where user_id = $1 and provider = $2
       limit 1`,
      [userId, provider],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return rowToConnection(result.rows[0]);
  });
}

export async function upsertOAuthConnection(
  userId: string,
  provider: OAuthProvider,
  input: OAuthTokenWriteInput,
): Promise<OAuthConnection> {
  return withUserTransaction(userId, async (client) => {
    const result = await client.query<OAuthConnectionRow>(
      `insert into public.oauth_connections (
        user_id,
        provider,
        access_token,
        refresh_token,
        token_scope,
        token_type,
        expiry_date
      )
      values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
      on conflict (user_id, provider) do update
      set
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_scope = excluded.token_scope,
        token_type = excluded.token_type,
        expiry_date = excluded.expiry_date
      returning
        user_id,
        provider,
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
        input.accessToken,
        input.refreshToken,
        input.tokenScope,
        input.tokenType,
        input.expiryDate,
      ],
    );

    return rowToConnection(result.rows[0]);
  });
}

export async function deleteOAuthConnection(userId: string, provider: OAuthProvider): Promise<void> {
  await withUserTransaction(userId, async (client) => {
    await client.query("delete from public.oauth_connections where user_id = $1 and provider = $2", [
      userId,
      provider,
    ]);
  });
}
