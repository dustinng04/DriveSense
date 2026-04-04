import type { JWTPayload } from "jose";

export interface AuthenticatedRequestContext {
  userId: string;
  token: string;
  claims: JWTPayload;
}

