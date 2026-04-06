import dotenv from "dotenv";

dotenv.config({ override: false });

const port = Number(process.env.NODE_PORT ?? "3001");

if (isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid NODE_PORT: ${process.env.NODE_PORT}. Must be a number between 1 and 65535.`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
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

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.DB_HOST ?? "localhost";
  const dbPort = Number(process.env.DB_PORT ?? "5432");
  const user = requireEnv("POSTGRES_USER");
  const password = requireEnv("POSTGRES_PASSWORD");
  const database = requireEnv("POSTGRES_DB");

  if (isNaN(dbPort) || dbPort <= 0 || dbPort > 65535) {
    throw new Error(`Invalid DB_PORT: ${process.env.DB_PORT}. Must be a number between 1 and 65535.`);
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${dbPort}/${database}`;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  databaseUrl: resolveDatabaseUrl(),
  supabaseJwtSecret: requireEnv("SUPABASE_JWT_SECRET"),
  supabaseJwtIssuer: process.env.SUPABASE_JWT_ISSUER,
  supabaseJwtAudience: process.env.SUPABASE_JWT_AUDIENCE,
  pyEngineBaseUrl: process.env.PY_ENGINE_BASE_URL,
  freeCallGeminiApiKey: process.env.FREE_CALL_GEMINI_API_KEY,
  freeCallTrialLimit: readIntegerEnv("FREE_CALL_TRIAL_LIMIT", 10, { min: 5, max: 10 }),
};

