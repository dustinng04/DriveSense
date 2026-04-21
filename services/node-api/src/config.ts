import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config({ override: false });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.NODE_PORT ?? "3001");

if (isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid NODE_PORT: ${process.env.NODE_PORT}. Must be a number between 1 and 65535.`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readIntegerEnv(
  name: string,
  defaultValue: number,
  options: { min: number; max: number },
): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new Error(
      `Invalid ${name}: ${rawValue}. Must be an integer between ${options.min} and ${options.max}.`,
    );
  }

  return parsed;
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw?.trim()) {
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  }

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveCorsAllowChromeExtension(): boolean {
  if (process.env.CORS_ALLOW_CHROME_EXTENSION === "true") {
    return true;
  }
  if (process.env.CORS_ALLOW_CHROME_EXTENSION === "false") {
    return false;
  }

  return (process.env.NODE_ENV ?? "development") !== "production";
}

function resolveDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  corsAllowedOrigins: parseCorsOrigins(),
  corsAllowChromeExtension: resolveCorsAllowChromeExtension(),
  databaseUrl: resolveDatabaseUrl(),
  supabaseJwtSecret: requireEnv("SUPABASE_JWT_SECRET"),
  supabaseJwtIssuer: process.env.SUPABASE_JWT_ISSUER,
  supabaseJwtAudience: process.env.SUPABASE_JWT_AUDIENCE,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseUrl: process.env.SUPABASE_URL,
  pyEngineBaseUrl: process.env.PY_ENGINE_BASE_URL,
  freeCallGeminiApiKey: process.env.FREE_CALL_GEMINI_API_KEY,
  freeCallTrialLimit: readIntegerEnv("FREE_CALL_TRIAL_LIMIT", 10, { min: 5, max: 15 }),
  googleDriveClientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
  googleDriveClientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
  googleDriveOauthRedirectUri: process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI,
  googleDriveOauthSuccessRedirect: process.env.GOOGLE_DRIVE_OAUTH_SUCCESS_REDIRECT,
  notionClientId: process.env.NOTION_CLIENT_ID,
  notionClientSecret: process.env.NOTION_CLIENT_SECRET,
  notionOauthRedirectUri: process.env.NOTION_OAUTH_REDIRECT_URI,
  notionOauthSuccessRedirect: process.env.NOTION_OAUTH_SUCCESS_REDIRECT,
  migrationsPath: process.env.MIGRATIONS_PATH ?? path.resolve(__dirname, "./db/migrations"),
};

