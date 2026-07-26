function getByPath(obj, path) {
  if (!path?.trim()) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Calls a custom HTTP translation API (arbitrary JSON). Configure via
 * `TRANS_API_BASE_URL`, `TRANS_HTTP_PATH`, `TRANS_HTTP_RESPONSE_FIELD` in `.env`.
 * @param {ReturnType<import("../config.js").getTransConfig>} cfg
 */
export function getHttpAdapter(cfg) {
  const base = cfg.apiBaseUrl;
  if (!base) {
    throw new Error("TRANS_ADAPTER=http but TRANS_API_BASE_URL is empty.");
  }

  return {
    /**
     * @param {import("./adapter.js").InterpretRequest} req
     */
    async translate(req) {
      const url = `${base}${cfg.httpPath.startsWith("/") ? "" : "/"}${cfg.httpPath}`;
      const headers = {
        "Content-Type": "application/json",
      };
      if (cfg.apiKey) {
        headers.Authorization = `Bearer ${cfg.apiKey}`;
      }

      const body = {
        text: req.text,
        sourceLocale: req.sourceLocale,
        targetLocale: req.targetLocale,
        tone: req.tone,
        domain: req.domain || undefined,
        maxLength: req.maxLength > 0 ? req.maxLength : undefined,
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const rawText = await res.text();
      let data;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Translation API returned non-JSON response: ${rawText.slice(0, 200)}`);
      }

      if (!res.ok) {
        const msg =
          typeof data.message === "string"
            ? data.message
            : typeof data.error === "string"
              ? data.error
              : res.statusText;
        throw new Error(msg || `Translation API error HTTP ${res.status}`);
      }

      const field = cfg.httpResponseField?.trim();
      let translated =
        (field && getByPath(data, field)) ||
        data.translatedText ||
        data.translation ||
        data.result ||
        data.text ||
        data.output;

      if (typeof translated !== "string") {
        throw new Error(
          "Could not find a string result in the translation API response. Set TRANS_HTTP_RESPONSE_FIELD or include translatedText (or similar) in the response."
        );
      }

      return translated;
    },
  };
}
