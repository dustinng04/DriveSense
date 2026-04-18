import { getLinkedAccountsPayload } from "../integrations/oauthConnectionsRepository.js";
import { generateAccessToken } from "./jwt.js";

/** JWT including verified linked platform account ids from DB (refreshed at issuance time). */
export async function generateAccessTokenWithLinkedAccounts(userId: string): Promise<string> {
  const linkedAccounts = await getLinkedAccountsPayload(userId);
  return generateAccessToken(userId, { linkedAccounts });
}
