import { getTransConfig } from "../config.js";
import { createAdapter } from "../adapter/adapter.js";
import { resolveDirection } from "../detectLocale.js";

/**
 * API contract (summary)
 *
 * POST /api/interpret
 * Request: { "text": string, "sourceHint"?: string, "targetHint"?: string }
 * Success: { "translatedText": string, "sourceLocale": string, "targetLocale": string }
 * Failure: { "error": { "code": string, "message": string } } — HTTP 400/500/502
 *
 * GET /api/config (no secrets)
 * Response: { "sourceLocale", "targetLocale", "tone", "maxLength"|null, "adapter" }
 *
 * @param {import("fastify").FastifyInstance} fastify
 */
export async function registerInterpretRoutes(fastify) {
  fastify.get("/api/config", async (_request, reply) => {
    const cfg = getTransConfig();
    const max = cfg.maxLength;
    return reply.send({
      sourceLocale: cfg.sourceLocale,
      targetLocale: cfg.targetLocale,
      tone: cfg.tone,
      maxLength: max > 0 ? max : null,
      adapter: cfg.adapter,
    });
  });

  fastify.post("/api/interpret", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const text = typeof body.text === "string" ? body.text : "";
    const sourceHint = typeof body.sourceHint === "string" ? body.sourceHint : undefined;
    const targetHint = typeof body.targetHint === "string" ? body.targetHint : undefined;

    if (!text.trim()) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "Text is empty." },
      });
    }

    const cfg = getTransConfig();
    const pair = { sourceLocale: cfg.sourceLocale, targetLocale: cfg.targetLocale };

    if (cfg.maxLength > 0 && text.length > cfg.maxLength) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: `Text exceeds the maximum allowed length (${cfg.maxLength} characters).`,
        },
      });
    }

    const { source, target } = resolveDirection(pair, sourceHint, targetHint, text);

    let adapter;
    try {
      adapter = createAdapter(cfg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({
        error: { code: "ADAPTER_CONFIG_ERROR", message },
      });
    }

    try {
      const translatedText = await adapter.translate({
        text,
        sourceLocale: source,
        targetLocale: target,
        tone: cfg.tone,
        domain: cfg.domain,
        maxLength: cfg.maxLength,
      });
      return reply.send({
        translatedText,
        sourceLocale: source,
        targetLocale: target,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      request.log.error(e);
      return reply.code(502).send({
        error: { code: "INTERPRET_FAILED", message },
      });
    }
  });
}
