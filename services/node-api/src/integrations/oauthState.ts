import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";
import { IntegrationError } from "./errors.js";

const encoder = new TextEncoder();

interface OAuthStatePayload {
  purpose: string;
  sub?: string;
  redirectUri?: string;
}

export async function createOauthState(userId: string, purpose: string): Promise<string> {
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(encoder.encode(config.supabaseJwtSecret));
}

export async function verifyOauthState(state: string, expectedPurpose: string): Promise<string> {
  try {
    const verification = await jwtVerify<OAuthStatePayload>(state, encoder.encode(config.supabaseJwtSecret));
    if (verification.payload.purpose !== expectedPurpose || !verification.payload.sub) {
      throw new IntegrationError(`Invalid OAuth state for purpose: ${expectedPurpose}.`, 400);
    }

    return verification.payload.sub;
  } catch (error) {
    if (error instanceof IntegrationError) {
      throw error;
    }
    throw new IntegrationError("OAuth state is invalid or expired.", 400);
  }
}

export async function createLoginState(purpose: string, options?: { redirectUri?: string }): Promise<string> {
  return new SignJWT({ purpose, redirectUri: options?.redirectUri })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(encoder.encode(config.supabaseJwtSecret));
}

export async function verifyLoginState(
  state: string,
  expectedPurpose: string,
): Promise<{ redirectUri?: string }> {
  try {
    const verification = await jwtVerify<OAuthStatePayload>(state, encoder.encode(config.supabaseJwtSecret));
    if (verification.payload.purpose !== expectedPurpose) {
      throw new IntegrationError(`Invalid OAuth login state for purpose: ${expectedPurpose}.`, 400);
    }
    return { redirectUri: verification.payload.redirectUri };
  } catch (error) {
    if (error instanceof IntegrationError) {
      throw error;
    }
    throw new IntegrationError("OAuth login state is invalid or expired.", 400);
  }
}
