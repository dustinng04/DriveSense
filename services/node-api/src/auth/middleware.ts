import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "./jwt.js";
import type { AuthenticatedRequestContext } from "./types.js";

interface AuthenticatedLocals {
  auth: AuthenticatedRequestContext;
}

function readBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export function requireAuth(
  req: Request,
  res: Response<unknown, Partial<AuthenticatedLocals>>,
  next: NextFunction,
) {
  const token = readBearerToken(req.header("authorization"));
  if (!token) {
    return res.status(401).json({
      error: "Missing or invalid Authorization header. Use Bearer <token>.",
    });
  }

  verifyAccessToken(token)
    .then((verified) => {
      res.locals.auth = {
        userId: verified.userId,
        token,
        claims: verified.claims,
      };
      next();
    })
    .catch(() => {
      return res.status(401).json({
        error: "Invalid or expired access token.",
      });
    });
}

