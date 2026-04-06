import {
  deleteOAuthConnection,
  getOAuthConnection,
  upsertOAuthConnection,
  type OAuthConnection,
  type OAuthTokenWriteInput,
} from "../integrations/oauthConnectionsRepository.js";

export type GoogleDriveConnection = OAuthConnection;
export type GoogleDriveTokenWriteInput = OAuthTokenWriteInput;

export async function getGoogleDriveConnection(userId: string): Promise<GoogleDriveConnection | null> {
  return getOAuthConnection(userId, "google_drive");
}

export async function upsertGoogleDriveConnection(
  userId: string,
  input: GoogleDriveTokenWriteInput,
): Promise<GoogleDriveConnection> {
  return upsertOAuthConnection(userId, "google_drive", input);
}

export async function deleteGoogleDriveConnection(userId: string): Promise<void> {
  await deleteOAuthConnection(userId, "google_drive");
}
