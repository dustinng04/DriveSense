import type { Response } from "express";
import { IntegrationError } from "./errors.js";

export function parsePageSize(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(String(value));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new IntegrationError("pageSize must be an integer between 1 and 100.", 400);
  }
  return parsed;
}

export function maybeRedirectAfterOAuth(
  res: Response,
  redirectBaseUrl: string | undefined,
  statusKey: string,
  payload: { ok: boolean; message?: string },
): Response | undefined {
  if (!redirectBaseUrl) {
    return undefined;
  }

  try {
    const redirectUrl = new URL(redirectBaseUrl);
    redirectUrl.searchParams.set(statusKey, payload.ok ? "true" : "false");
    if (payload.message) {
      redirectUrl.searchParams.set("message", payload.message);
    }
    res.redirect(302, redirectUrl.toString());
    return res;
  } catch {
    return undefined;
  }
}

export function sendErrorResponse(
  res: Response,
  fallbackError: string,
  error: unknown,
): Response {
  if (error instanceof IntegrationError) {
    return res.status(error.statusCode).json({
      error: fallbackError,
      message: error.details ?? error.message,
    });
  }

  return res.status(500).json({
    error: fallbackError,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}
