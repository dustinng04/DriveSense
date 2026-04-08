/**
 * Build-time configuration (injected by Vite from `API_URL` / `VITE_*` env vars).
 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

const rawApi = import.meta.env.VITE_API_URL as string | undefined;
const rawDash = import.meta.env.VITE_DASHBOARD_URL as string | undefined;

export const API_URL = trimTrailingSlash(
  rawApi?.trim() ? rawApi.trim() : "http://localhost:3001",
);

export const DASHBOARD_URL = trimTrailingSlash(
  rawDash?.trim() ? rawDash.trim() : "http://localhost:5173",
);

/** Dev-only: optional bearer token applied on install when storage has no token */
export const BUILD_TIME_BEARER_TOKEN = (
  (import.meta.env.VITE_API_BEARER_TOKEN as string | undefined) ?? ""
).trim();
