import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./db.js";

const appJsonPath = path.join(dataDir, "app.json");

let cachedKey = null;
let cachedMtime = 0;

/**
 * @returns {string}
 */
export function getGeminiApiKey() {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  try {
    const st = fs.statSync(appJsonPath);
    if (st.mtimeMs !== cachedMtime || cachedKey == null) {
      const raw = fs.readFileSync(appJsonPath, "utf8");
      const j = JSON.parse(raw);
      cachedKey = typeof j.geminiApiKey === "string" ? j.geminiApiKey.trim() : "";
      cachedMtime = st.mtimeMs;
    }
    return cachedKey || "";
  } catch {
    return "";
  }
}
