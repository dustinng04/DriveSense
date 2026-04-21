import { config } from "../config.js";
import {
  IntegrationNotConnectedError,
  TokenRefreshUnavailableError,
  UpstreamApiError,
  UpstreamOAuthError,
} from "../integrations/errors.js";
import { createOauthState, verifyOauthState } from "../integrations/oauthState.js";
import {
  deleteNotionConnection,
  getNotionConnection,
  listNotionAccountSummaries,
  upsertNotionConnection,
  type NotionConnection,
  type NotionTokenWriteInput,
} from "./repository.js";

const NOTION_OAUTH_BASE = "https://api.notion.com/v1/oauth/authorize";
const NOTION_OAUTH_TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2022-06-28";

interface NotionTokenResponse {
  access_token: string;
  token_type?: string;
  bot_id?: string;
  workspace_name?: string;
  workspace_icon?: string;
  workspace_id?: string;
  owner?: unknown;
  duplicated_template_id?: string | null;
  request_id?: string;
  refresh_token?: string;
  expires_in?: number;
}

function assertNotionOauthConfigured() {
  if (!config.notionClientId || !config.notionClientSecret || !config.notionOauthRedirectUri) {
    throw new Error(
      "Notion OAuth is not configured. Set NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, and NOTION_OAUTH_REDIRECT_URI.",
    );
  }
}

function sanitizeTokenWrite(input: NotionTokenResponse, fallbackRefreshToken: string | null) {
  const expiryDate =
    typeof input.expires_in === "number" && input.expires_in > 0
      ? new Date(Date.now() + input.expires_in * 1000).toISOString()
      : null;

  return {
    accessToken: input.access_token,
    refreshToken: input.refresh_token ?? fallbackRefreshToken,
    tokenScope: null,
    tokenType: input.token_type ?? null,
    expiryDate,
  };
}

/** Deterministic inbox for Supabase/DriveSense user creation only */
function notionAuthSyntheticEmail(workspaceId: string): string {
  const id = workspaceId.trim();
  return `${id.replace(/[@\s]/g, "_")}@notion.oauth.drivesense.internal`;
}

function buildNotionWrite(
  tokens: NotionTokenResponse,
  fallbackRefreshToken: string | null,
  accountId: string,
): NotionTokenWriteInput {
  const base = sanitizeTokenWrite(tokens, fallbackRefreshToken);
  return {
    ...base,
    accountId,
  };
}

function getNotionBasicAuthHeader() {
  assertNotionOauthConfigured();
  const credentials = `${config.notionClientId}:${config.notionClientSecret}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function parseNotionError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const message = payload.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
    const code = payload.code;
    if (typeof code === "string" && code.trim().length > 0) {
      return code;
    }
  } catch {
    // Ignore parse errors and fallback to status text.
  }

  return `${response.status} ${response.statusText}`.trim();
}

async function exchangeCodeForTokens(code: string): Promise<NotionTokenResponse> {
  assertNotionOauthConfigured();

  const response = await fetch(NOTION_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: getNotionBasicAuthHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.notionOauthRedirectUri,
    }),
  });

  if (!response.ok) {
    throw new UpstreamOAuthError("Notion", "token exchange", await parseNotionError(response));
  }

  return (await response.json()) as NotionTokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<NotionTokenResponse> {
  assertNotionOauthConfigured();

  const response = await fetch(NOTION_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: getNotionBasicAuthHeader(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new UpstreamOAuthError("Notion", "token refresh", await parseNotionError(response));
  }

  return (await response.json()) as NotionTokenResponse;
}

function isExpired(connection: NotionConnection): boolean {
  if (!connection.expiryDate) {
    return false;
  }

  const expiresAt = Date.parse(connection.expiryDate);
  if (Number.isNaN(expiresAt)) {
    return false;
  }

  return expiresAt <= Date.now() + 60_000;
}

async function getAccessToken(userId: string, accountId: string, options?: { forceRefresh?: boolean }): Promise<string> {
  const connection = await getNotionConnection(userId, accountId);
  if (!connection) {
    throw new IntegrationNotConnectedError("Notion");
  }

  const shouldRefresh = options?.forceRefresh || isExpired(connection);
  if (!shouldRefresh) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) {
    throw new TokenRefreshUnavailableError("Notion");
  }

  const refreshed = await refreshAccessToken(connection.refreshToken);
  const next = await upsertNotionConnection(
    userId,
    buildNotionWrite(refreshed, connection.refreshToken, connection.accountId),
  );
  return next.accessToken;
}

async function notionRequest(
  userId: string,
  accountId: string,
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const url = new URL(path, NOTION_API_BASE);
  const runRequest = async (token: string): Promise<Response> => {
    return fetch(url, {
      method: options?.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
        ...(options?.body ? { "content-type": "application/json" } : {}),
        ...(options?.headers ?? {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  };

  let response = await runRequest(await getAccessToken(userId, accountId));
  if ((response.status === 401 || response.status === 403) && (await getNotionConnection(userId, accountId))?.refreshToken) {
    response = await runRequest(await getAccessToken(userId, accountId, { forceRefresh: true }));
  }

  if (!response.ok) {
    const details = await parseNotionError(response);
    const statusCode = response.status === 401 || response.status === 403 ? 401 : 502;
    throw new UpstreamApiError("Notion", details, statusCode);
  }

  return response;
}

export async function createNotionOauthState(userId: string): Promise<string> {
  return createOauthState(userId, "notion-oauth");
}

export async function verifyNotionOauthState(state: string): Promise<string> {
  return verifyOauthState(state, "notion-oauth");
}

export async function getNotionOauthUrl(userId: string): Promise<string> {
  assertNotionOauthConfigured();

  const state = await createNotionOauthState(userId);
  const url = new URL(NOTION_OAUTH_BASE);
  url.searchParams.set("client_id", config.notionClientId!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", config.notionOauthRedirectUri!);
  url.searchParams.set("state", state);

  return url.toString();
}

export async function getNotionLoginUrl(): Promise<string> {
  assertNotionOauthConfigured();

  const { createLoginState } = await import("../integrations/oauthState.js");
  const state = await createLoginState("notion-login");
  const url = new URL(NOTION_OAUTH_BASE);
  url.searchParams.set("client_id", config.notionClientId!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", config.notionOauthRedirectUri!);
  url.searchParams.set("state", state);

  return url.toString();
}

export async function handleNotionOAuthCallback(params: { code: string; state: string }) {
  const userId = await verifyNotionOauthState(params.state);
  const tokens = await exchangeCodeForTokens(params.code);

  if (!tokens.workspace_id?.trim()) {
    throw new Error("Notion OAuth did not return workspace_id.");
  }

  await upsertNotionConnection(userId, buildNotionWrite(tokens, null, tokens.workspace_id.trim()));
  return userId;
}

export async function handleNotionLoginCallback(params: { code: string; state: string }): Promise<string> {
  const { verifyLoginState } = await import("../integrations/oauthState.js");
  const { getOrCreateAuthUser } = await import("../auth/admin.js");

  await verifyLoginState(params.state, "notion-login");
  const tokens = await exchangeCodeForTokens(params.code);

  if (!tokens.workspace_id?.trim()) {
    throw new Error("Notion OAuth did not return workspace_id.");
  }

  const workspaceIdTrimmed = tokens.workspace_id.trim();
  const userId = await getOrCreateAuthUser(notionAuthSyntheticEmail(workspaceIdTrimmed));
  await upsertNotionConnection(userId, buildNotionWrite(tokens, null, workspaceIdTrimmed));
  return userId;
}

export async function getNotionConnectionStatus(userId: string) {
  const accounts = await listNotionAccountSummaries(userId);
  if (accounts.length === 0) {
    return { connected: false as const, accounts: [] as const };
  }

  return {
    connected: true as const,
    accounts: accounts.map((a) => ({
      accountId: a.accountId,
      isPrimary: a.isPrimary,
    })),
  };
}

export async function disconnectNotion(userId: string, accountId: string) {
  await deleteNotionConnection(userId, accountId);
}

export async function queryNotionDatabase(params: {
  userId: string;
  accountId: string;
  databaseId: string;
  filter?: unknown;
  sorts?: unknown;
  startCursor?: string;
  pageSize?: number;
}) {
  const requestBody: Record<string, unknown> = {};
  if (params.filter !== undefined) {
    requestBody.filter = params.filter;
  }
  if (params.sorts !== undefined) {
    requestBody.sorts = params.sorts;
  }
  if (params.startCursor) {
    requestBody.start_cursor = params.startCursor;
  }
  if (typeof params.pageSize === "number") {
    requestBody.page_size = params.pageSize;
  }

  const response = await notionRequest(
    params.userId,
    params.accountId,
    `/databases/${encodeURIComponent(params.databaseId)}/query`,
    {
      method: "POST",
      body: requestBody,
    },
  );

  return response.json();
}

export async function readNotionPage(userId: string, accountId: string, pageId: string) {
  const response = await notionRequest(userId, accountId, `/pages/${encodeURIComponent(pageId)}`);
  return response.json();
}

export async function updateNotionPage(params: {
  userId: string;
  accountId: string;
  pageId: string;
  properties?: unknown;
  icon?: unknown;
  cover?: unknown;
  archived?: boolean;
  inTrash?: boolean;
}) {
  const requestBody: Record<string, unknown> = {};
  if (params.properties !== undefined) {
    requestBody.properties = params.properties;
  }
  if (params.icon !== undefined) {
    requestBody.icon = params.icon;
  }
  if (params.cover !== undefined) {
    requestBody.cover = params.cover;
  }
  if (typeof params.archived === "boolean") {
    requestBody.archived = params.archived;
  }
  if (typeof params.inTrash === "boolean") {
    requestBody.in_trash = params.inTrash;
  }

  const response = await notionRequest(params.userId, params.accountId, `/pages/${encodeURIComponent(params.pageId)}`, {
    method: "PATCH",
    body: requestBody,
  });
  return response.json();
}

export async function listNotionBlockChildren(params: {
  userId: string;
  accountId: string;
  blockId: string;
  pageSize?: number;
  startCursor?: string;
}) {
  const query: Record<string, string | number | undefined> = {
    page_size: params.pageSize,
    start_cursor: params.startCursor,
  };

  const url = new URL(`${NOTION_API_BASE}/blocks/${encodeURIComponent(params.blockId)}/children`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await notionRequest(params.userId, params.accountId, url.toString());
  return response.json();
}

export async function readNotionPageMarkdown(
  userId: string,
  accountId: string,
  pageId: string,
): Promise<string> {
  const response = await notionRequest(
    userId,
    accountId,
    `/pages/${encodeURIComponent(pageId)}/markdown`,
  );

  const data = (await response.json()) as { markdown?: string };
  return data.markdown ?? '';
}
