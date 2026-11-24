import { existsSync } from "node:fs";

/** Load .env.local for scripts (Next.js loads it by itself for the app). */
export function loadEnv() {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
}
