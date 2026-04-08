import { config } from "../config.js";
import {
  IntegrationNotConnectedError,
  TokenRefreshUnavailableError,
  UpstreamApiError,
  UpstreamOAuthError,
} from "../integrations/errors.js";
import { createOauthState, verifyOauthState } from "../integrations/oauthState.js";
import {
  deleteGoogleDriveConnection,
  getGoogleDriveConnection,
  upsertGoogleDriveConnection,
  type GoogleDriveConnection,
} from "./repository.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

function assertGoogleOauthConfigured() {
  if (!config.googleDriveClientId || !config.googleDriveClientSecret || !config.googleDriveOauthRedirectUri) {
    throw new Error(
      "Google Drive OAuth is not configured. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_OAUTH_REDIRECT_URI.",
    );
  }
}

function sanitizeTokenWrite(input: GoogleTokenResponse, fallbackRefreshToken: string | null) {
  const expiryDate =
    typeof input.expires_in === "number" && input.expires_in > 0
      ? new Date(Date.now() + input.expires_in * 1000).toISOString()
      : null;

  return {
    accessToken: input.access_token,
    refreshToken: input.refresh_token ?? fallbackRefreshToken,
    tokenScope: input.scope ?? null,
    tokenType: input.token_type ?? null,
    expiryDate,
  };
}

async function parseGoogleError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const rawError = payload.error;

    if (typeof rawError === "string") {
      const description = payload.error_description;
      return typeof description === "string" ? description : rawError;
    }

    if (typeof rawError === "object" && rawError !== null) {
      const nestedMessage = (rawError as { message?: unknown }).message;
      if (typeof nestedMessage === "string") {
        return nestedMessage;
      }
    }
  } catch {
    // Ignore parse errors and fallback to status text.
  }

  return `${response.status} ${response.statusText}`.trim();
}

async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  assertGoogleOauthConfigured();

  const body = new URLSearchParams({
    code,
    client_id: config.googleDriveClientId!,
    client_secret: config.googleDriveClientSecret!,
    redirect_uri: config.googleDriveOauthRedirectUri!,
    grant_type: "authorization_code",
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new UpstreamOAuthError("Google Drive", "token exchange", await parseGoogleError(response));
  }

  return (await response.json()) as GoogleTokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  assertGoogleOauthConfigured();

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.googleDriveClientId!,
    client_secret: config.googleDriveClientSecret!,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new UpstreamOAuthError("Google Drive", "token refresh", await parseGoogleError(response));
  }

  return (await response.json()) as GoogleTokenResponse;
}

function isExpired(connection: GoogleDriveConnection): boolean {
  if (!connection.expiryDate) {
    return false;
  }

  const expiresAt = Date.parse(connection.expiryDate);
  if (Number.isNaN(expiresAt)) {
    return false;
  }

  return expiresAt <= Date.now() + 60_000;
}

async function getAccessToken(userId: string, options?: { forceRefresh?: boolean }): Promise<string> {
  const connection = await getGoogleDriveConnection(userId);
  if (!connection) {
    throw new IntegrationNotConnectedError("Google Drive");
  }

  const shouldRefresh = options?.forceRefresh || isExpired(connection);
  if (!shouldRefresh) {
    return connection.accessToken;
  }

  if (!connection.refreshToken) {
    throw new TokenRefreshUnavailableError("Google Drive");
  }

  const refreshed = await refreshAccessToken(connection.refreshToken);
  const next = await upsertGoogleDriveConnection(
    userId,
    sanitizeTokenWrite(refreshed, connection.refreshToken),
  );
  return next.accessToken;
}

async function driveRequest(
  userId: string,
  path: string,
  options?: {
    method?: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const buildUrl = () => {
    const url = new URL(path, GOOGLE_DRIVE_API_BASE);
    const query = options?.query ?? {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  };

  const runRequest = async (token: string): Promise<Response> => {
    return fetch(buildUrl(), {
      method: options?.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(options?.body ? { "content-type": "application/json" } : {}),
        ...(options?.headers ?? {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  };

  let response = await runRequest(await getAccessToken(userId));
  if ((response.status === 401 || response.status === 403) && (await getGoogleDriveConnection(userId))?.refreshToken) {
    response = await runRequest(await getAccessToken(userId, { forceRefresh: true }));
  }

  if (!response.ok) {
    const details = await parseGoogleError(response);
    const statusCode = response.status === 401 || response.status === 403 ? 401 : 502;
    throw new UpstreamApiError("Google Drive", details, statusCode);
  }

  return response;
}

function buildGoogleExportMimeType(mimeType: string): string {
  if (mimeType === "application/vnd.google-apps.document") {
    return "text/plain";
  }
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return "text/csv";
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return "text/plain";
  }
  return "application/pdf";
}

export async function createGoogleDriveOauthState(userId: string): Promise<string> {
  return createOauthState(userId, "google-drive-oauth");
}

export async function verifyGoogleDriveOauthState(state: string): Promise<string> {
  return verifyOauthState(state, "google-drive-oauth");
}

export async function getGoogleDriveOauthUrl(userId: string): Promise<string> {
  assertGoogleOauthConfigured();

  const state = await createGoogleDriveOauthState(userId);
  const url = new URL(GOOGLE_OAUTH_BASE);
  url.searchParams.set("client_id", config.googleDriveClientId!);
  url.searchParams.set("redirect_uri", config.googleDriveOauthRedirectUri!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE + " email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function getGoogleDriveLoginUrl(): Promise<string> {
  assertGoogleOauthConfigured();

  const { createLoginState } = await import("../integrations/oauthState.js");
  const state = await createLoginState("google-drive-login");
  const url = new URL(GOOGLE_OAUTH_BASE);
  url.searchParams.set("client_id", config.googleDriveClientId!);
  url.searchParams.set("redirect_uri", config.googleDriveOauthRedirectUri!);
  url.searchParams.set("response_type", "code");
  // Add email and profile scopes to fetch user info for login
  url.searchParams.set("scope", DRIVE_SCOPE + " email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function handleGoogleDriveOAuthCallback(params: { code: string; state: string }) {
  const userId = await verifyGoogleDriveOauthState(params.state);
  const tokens = await exchangeCodeForTokens(params.code);

  await upsertGoogleDriveConnection(userId, sanitizeTokenWrite(tokens, null));
  return userId;
}

export async function handleGoogleDriveLoginCallback(params: { code: string; state: string }): Promise<string> {
  const { verifyLoginState } = await import("../integrations/oauthState.js");
  const { getOrCreateAuthUser } = await import("../auth/admin.js");
  
  await verifyLoginState(params.state, "google-drive-login");
  const tokens = await exchangeCodeForTokens(params.code);

  // Fetch user info using the access token
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    throw new Error(`Failed to fetch Google user info: ${await userInfoRes.text()}`);
  }

  const userInfo = await userInfoRes.json() as { email: string; id: string };
  if (!userInfo.email) {
    throw new Error("Google OAuth did not return an email address.");
  }

  const userId = await getOrCreateAuthUser(userInfo.email);
  await upsertGoogleDriveConnection(userId, sanitizeTokenWrite(tokens, null));
  
  return userId;
}

export async function getGoogleDriveConnectionStatus(userId: string) {
  const connection = await getGoogleDriveConnection(userId);
  if (!connection) {
    return { connected: false };
  }

  return {
    connected: true,
    tokenScope: connection.tokenScope,
    tokenType: connection.tokenType,
    expiryDate: connection.expiryDate,
    updatedAt: connection.updatedAt,
  };
}

export async function disconnectGoogleDrive(userId: string) {
  await deleteGoogleDriveConnection(userId);
}

export async function listGoogleDriveFiles(params: {
  userId: string;
  q?: string;
  pageToken?: string;
  pageSize?: number;
}) {
  const response = await driveRequest(params.userId, "/files", {
    query: {
      q: params.q ?? "trashed = false",
      pageSize: params.pageSize ?? 25,
      pageToken: params.pageToken,
      fields:
        "nextPageToken, files(id, name, mimeType, parents, trashed, modifiedTime, webViewLink, size)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    },
  });

  return response.json();
}

export async function readGoogleDriveFileMetadata(userId: string, fileId: string) {
  const response = await driveRequest(userId, `/files/${encodeURIComponent(fileId)}`, {
    query: {
      fields: "id, name, mimeType, parents, trashed, modifiedTime, webViewLink, size",
      supportsAllDrives: "true",
    },
  });

  return response.json();
}

export async function readGoogleDriveFileContent(userId: string, fileId: string) {
  const metadata = (await readGoogleDriveFileMetadata(userId, fileId)) as { mimeType: string; name: string };

  let response: Response;
  if (metadata.mimeType.startsWith("application/vnd.google-apps")) {
    response = await driveRequest(userId, `/files/${encodeURIComponent(fileId)}/export`, {
      query: {
        mimeType: buildGoogleExportMimeType(metadata.mimeType),
      },
    });
  } else {
    response = await driveRequest(userId, `/files/${encodeURIComponent(fileId)}`, {
      query: {
        alt: "media",
        supportsAllDrives: "true",
      },
    });
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    fileId,
    name: metadata.name,
    mimeType: metadata.mimeType,
    contentType,
    encoding: "base64" as const,
    contentBase64: bytes.toString("base64"),
  };
}

export async function moveGoogleDriveFile(userId: string, fileId: string, folderId: string) {
  const current = (await driveRequest(userId, `/files/${encodeURIComponent(fileId)}`, {
    query: {
      fields: "id, parents",
      supportsAllDrives: "true",
    },
  }).then((res) => res.json())) as { parents?: string[] };

  const removeParents = (current.parents ?? []).join(",");
  const response = await driveRequest(userId, `/files/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    query: {
      addParents: folderId,
      removeParents: removeParents.length > 0 ? removeParents : undefined,
      fields: "id, name, parents, trashed, modifiedTime",
      supportsAllDrives: "true",
    },
  });

  return response.json();
}

export async function trashGoogleDriveFile(userId: string, fileId: string) {
  const response = await driveRequest(userId, `/files/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    query: {
      fields: "id, name, trashed, modifiedTime",
      supportsAllDrives: "true",
    },
    body: { trashed: true },
  });

  return response.json();
}
