import { jwtVerify, type JWTPayload } from "jose";
import { config } from "../config.js";

const encoder = new TextEncoder();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeAudience(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}

function sanitizeIssuer(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value ? value : undefined;
}

export interface VerifiedAccessToken {
  userId: string;
  claims: JWTPayload;
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
  const verification = await jwtVerify(token, encoder.encode(config.supabaseJwtSecret), {
    audience: sanitizeAudience(config.supabaseJwtAudience) ?? "authenticated",
    issuer: sanitizeIssuer(config.supabaseJwtIssuer),
  });

  const userId = verification.payload.sub;
  if (!userId || !uuidPattern.test(userId)) {
    throw new Error("Token does not contain a valid user id (sub).");
  }

  return {
    userId,
    claims: verification.payload,
  };
}

