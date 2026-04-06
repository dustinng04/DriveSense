import {
  deleteOAuthConnection,
  getOAuthConnection,
  upsertOAuthConnection,
  type OAuthConnection,
  type OAuthTokenWriteInput,
} from "../integrations/oauthConnectionsRepository.js";

export type NotionConnection = OAuthConnection;
export type NotionTokenWriteInput = OAuthTokenWriteInput;

export async function getNotionConnection(userId: string): Promise<NotionConnection | null> {
  return getOAuthConnection(userId, "notion");
}

export async function upsertNotionConnection(
  userId: string,
  input: NotionTokenWriteInput,
): Promise<NotionConnection> {
  return upsertOAuthConnection(userId, "notion", input);
}

export async function deleteNotionConnection(userId: string): Promise<void> {
  await deleteOAuthConnection(userId, "notion");
}
