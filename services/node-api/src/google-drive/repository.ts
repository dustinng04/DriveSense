import {
  deleteOAuthConnection,
  getOAuthConnection,
  listOAuthAccountSummaries,
  upsertOAuthConnection,
  type OAuthAccountSummary,
  type OAuthConnection,
  type OAuthTokenWriteInput,
} from "../integrations/oauthConnectionsRepository.js";

export type GoogleDriveConnection = OAuthConnection;
export type GoogleDriveTokenWriteInput = OAuthTokenWriteInput;
export type GoogleDriveAccountSummary = OAuthAccountSummary;

export async function getGoogleDriveConnection(
  userId: string,
  accountId: string,
): Promise<GoogleDriveConnection | null> {
  return getOAuthConnection(userId, "google_drive", accountId);
}

export async function listGoogleDriveAccountSummaries(userId: string): Promise<GoogleDriveAccountSummary[]> {
  return listOAuthAccountSummaries(userId, "google_drive");
}

export async function upsertGoogleDriveConnection(
  userId: string,
  input: GoogleDriveTokenWriteInput,
): Promise<GoogleDriveConnection> {
  return upsertOAuthConnection(userId, "google_drive", input);
}

export async function deleteGoogleDriveConnection(userId: string, accountId: string): Promise<void> {
  await deleteOAuthConnection(userId, "google_drive", accountId);
}
