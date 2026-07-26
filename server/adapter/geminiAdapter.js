import { GoogleGenAI } from "@google/genai";
import { getTransConfig } from "../config.js";
import { getGeminiApiKey } from "../geminiKey.js";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/** Models Google has retired for new API users — map to a supported equivalent. */
const DEPRECATED_GEMINI_MODELS = {
  "gemini-2.5-flash-lite": DEFAULT_GEMINI_MODEL,
  "gemini-2.0-flash-lite": "gemini-2.0-flash",
};

function resolveGeminiModel() {
  const requested = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  return DEPRECATED_GEMINI_MODELS[requested] || requested;
}

/**
 * @param {string} text
 * @param {string} targetLocale BCP-47
 * @returns {Promise<string>}
 */
export async function translateWithGemini(text, targetLocale) {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set. Add GEMINI_API_KEY to .env or data/app.json on the server.");
  }

  const cfg = getTransConfig();
  const tone = cfg.tone || "neutral";
  const domain = cfg.domain?.trim();

  const domainLine = domain ? `Domain/context: ${domain}. ` : "";
  const prompt = `${domainLine}Tone: ${tone}. Translate the following text naturally into locale ${targetLocale}. Do not change the meaning. Output only the translation (no quotes or commentary).\n\n---\n${text}`;

  const ai = new GoogleGenAI({ apiKey: key });
  const model = resolveGeminiModel();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const trimmed = response.text?.trim() ?? "";
  if (!trimmed) throw new Error("Gemini returned an empty response.");
  return trimmed;
}
