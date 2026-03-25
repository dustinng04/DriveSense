import dotenv from "dotenv";

dotenv.config({ override: false });

const port = Number(process.env.NODE_PORT ?? "3001");

if (isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid NODE_PORT: ${process.env.NODE_PORT}. Must be a number between 1 and 65535.`);
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port,
  pyEngineBaseUrl: process.env.PY_ENGINE_BASE_URL,
};

