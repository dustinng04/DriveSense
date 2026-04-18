import {
  deleteOAuthConnection,
  getOAuthConnection,
  listOAuthAccountSummaries,
  upsertOAuthConnection,
  type OAuthAccountSummary,
  type OAuthConnection,
  type OAuthTokenWriteInput,
} from "../integrations/oauthConnectionsRepository.js";

export type NotionConnection = OAuthConnection;
export type NotionTokenWriteInput = OAuthTokenWriteInput;
export type NotionAccountSummary = OAuthAccountSummary;

export async function getNotionConnection(userId: string, accountId: string): Promise<NotionConnection | null> {
  return getOAuthConnection(userId, "notion", accountId);
}

export async function listNotionAccountSummaries(userId: string): Promise<NotionAccountSummary[]> {
  return listOAuthAccountSummaries(userId, "notion");
}

export async function upsertNotionConnection(
  userId: string,
  input: NotionTokenWriteInput,
): Promise<NotionConnection> {
  return upsertOAuthConnection(userId, "notion", input);
}

export async function deleteNotionConnection(userId: string, accountId: string): Promise<void> {
  await deleteOAuthConnection(userId, "notion", accountId);
}
