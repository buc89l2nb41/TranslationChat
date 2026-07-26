import dotenv from "dotenv";

dotenv.config({ override: true });
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getTransConfig() {
  return {
    sourceLocale: process.env.TRANS_SOURCE_LOCALE || "en",
    targetLocale: process.env.TRANS_TARGET_LOCALE || "ko",
    tone: process.env.TRANS_TONE || "neutral",
    domain: process.env.TRANS_DOMAIN || "",
    maxLength: num("TRANS_MAX_LENGTH", 0),
    adapter: process.env.TRANS_ADAPTER || "stub",
    apiKey: process.env.TRANS_API_KEY || "",
    apiBaseUrl: (process.env.TRANS_API_BASE_URL || "").replace(/\/$/, ""),
    httpPath: process.env.TRANS_HTTP_PATH || "/translate",
    httpResponseField: process.env.TRANS_HTTP_RESPONSE_FIELD || "",
  };
}

export function getServerConfig() {
  return {
    port: num("PORT", 80),
    host: process.env.HOST || "0.0.0.0",
    publicDir: path.join(__dirname, "../public"),
  };
}

/** Max messages returned for feed and shown in UI (1–500). */
export function getFeedDisplayLimit() {
  const n = num("FEED_DISPLAY_LIMIT", 50);
  return Math.max(1, Math.min(500, n));
}

/** Parallel Gemini calls when batch-translating (1–16). */
export function getTranslateConcurrency() {
  const n = num("TRANSLATE_CONCURRENCY", 4);
  return Math.max(1, Math.min(16, n));
}

/** Max message IDs per /api/translate/batch request (1–200). */
export function getTranslateBatchMax() {
  const n = num("TRANSLATE_BATCH_MAX", 50);
  return Math.max(1, Math.min(200, n));
}
