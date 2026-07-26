import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { getFeedDisplayLimit, getTranslateBatchMax, getTranslateConcurrency } from "../config.js";
import { translateWithGemini } from "../adapter/geminiAdapter.js";
import {
  addMessage,
  getCachedTranslation,
  getMessageById,
  listMessagesAfter,
  listRecentMessages,
  onMessageAdded,
  setCachedTranslation,
} from "../messageStore.js";

/** In-flight Gemini calls keyed by messageId + locale (dedupe concurrent requests). */
/** @type {Map<string, Promise<string>>} */
const translationInflight = new Map();

/**
 * @param {number} messageId
 * @param {string} targetLocale
 */
function translationKey(messageId, targetLocale) {
  return `${messageId}\0${targetLocale}`;
}

const COOKIE_NAME = "trans_uid";

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} reply
 */
function ensureUser(request, reply) {
  let id = request.cookies[COOKIE_NAME];
  if (id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (row) return row;
  }
  id = randomUUID();
  const now = Date.now();
  db.prepare(
    "INSERT INTO users (id, display_name, country_code, locale, created_at) VALUES (?,?,?,?,?)"
  ).run(id, "", "", "en", now);
  reply.setCookie(COOKIE_NAME, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    signed: false,
    maxAge: 60 * 60 * 24 * 400,
  });
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

/**
 * @param {{ id: number, userId: string, body: string, createdAt: number }} m
 */
function enrichMessage(m) {
  const u = db.prepare("SELECT display_name, locale FROM users WHERE id = ?").get(m.userId);
  return {
    id: m.id,
    user_id: m.userId,
    body: m.body,
    created_at: m.createdAt,
    author_name: u?.display_name ?? "",
    author_locale: u?.locale ?? "en",
  };
}

/** @type {Set<{ reply: import("fastify").FastifyReply; viewerId: string }>} */
const sseClients = new Set();

/**
 * @param {{ id: number, userId: string, body: string, createdAt: number }} raw
 */
function broadcastSseMessage(raw) {
  const row = enrichMessage(raw);
  const base = {
    id: row.id,
    body: row.body,
    translatedText: null,
    authorName: row.author_name || "",
    authorLocale: row.author_locale,
    createdAt: row.created_at,
  };
  for (const client of sseClients) {
    const message = { ...base, isOwn: row.user_id === client.viewerId };
    const line = `data: ${JSON.stringify({ type: "message", message })}\n\n`;
    try {
      client.reply.raw.write(line);
    } catch {
      sseClients.delete(client);
    }
  }
}

onMessageAdded((msg) => broadcastSseMessage(msg));

/**
 * @param {import("fastify").FastifyInstance} fastify
 */
export async function registerApiRoutes(fastify) {
  fastify.get("/api/me", async (request, reply) => {
    const user = ensureUser(request, reply);
    return {
      user: {
        id: user.id,
        displayName: user.display_name,
        countryCode: user.country_code,
        locale: user.locale,
        createdAt: user.created_at,
      },
    };
  });

  fastify.patch("/api/me", async (request, reply) => {
    const user = ensureUser(request, reply);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : user.display_name;
    const countryCode =
      typeof body.countryCode === "string"
        ? body.countryCode.trim().toUpperCase().slice(0, 2)
        : user.country_code ?? "";
    const locale = typeof body.locale === "string" ? body.locale.trim().slice(0, 48) : user.locale;

    db.prepare("UPDATE users SET display_name = ?, country_code = ?, locale = ? WHERE id = ?").run(
      displayName,
      countryCode,
      locale,
      user.id
    );
    const next = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    return {
      user: {
        id: next.id,
        displayName: next.display_name,
        countryCode: next.country_code,
        locale: next.locale,
        createdAt: next.created_at,
      },
    };
  });

  /** Messages use messageStore (in-memory) only; lost on restart. */
  fastify.post("/api/messages", async (request, reply) => {
    const user = ensureUser(request, reply);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const text = typeof body.body === "string" ? body.body : "";
    if (!text.trim()) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Message body is empty." } });
    }
    const { id, createdAt } = addMessage(user.id, text);
    return reply.code(201).send({ id, createdAt });
  });

  fastify.get("/api/feed", async (request, reply) => {
    const viewer = ensureUser(request, reply);
    const since = request.query.since ? Number(request.query.since) : 0;
    const feedLimit = getFeedDisplayLimit();

    const raw =
      since > 0 ? listMessagesAfter(since) : listRecentMessages(feedLimit);

    const rows = raw.map((m) => enrichMessage(m));
    const viewerLocale = viewer.locale || "en";

    const out = [];

    for (const row of rows) {
      out.push({
        id: row.id,
        body: row.body,
        translatedText: feedTranslatedText(row, viewer.id, viewerLocale),
        authorName: row.author_name || "",
        authorLocale: row.author_locale,
        createdAt: row.created_at,
        isOwn: row.user_id === viewer.id,
      });
    }

    return { messages: out, feedLimit, translateBatchMax: getTranslateBatchMax() };
  });

  /** SSE: push new messages immediately (session via same-origin cookies). */
  fastify.get("/api/feed/stream", async (request, reply) => {
    const viewer = ensureUser(request, reply);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": ok\n\n");
    const client = { reply, viewerId: viewer.id };
    sseClients.add(client);
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(client);
      }
    }, 25000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
    });
  });

  /**
   * Batch translate: one Gemini call per message (cache miss only).
   * Parallelism is capped by TRANSLATE_CONCURRENCY. Results stay in memory with the message.
   */
  fastify.post("/api/translate/batch", async (request, reply) => {
    const viewer = ensureUser(request, reply);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const targetLocale =
      typeof body.targetLocale === "string" && body.targetLocale.trim()
        ? body.targetLocale.trim().slice(0, 48)
        : "en";
    const rawIds = Array.isArray(body.messageIds) ? body.messageIds : [];
    const uniqueIds = [...new Set(rawIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
    const maxBatch = getTranslateBatchMax();
    const messageIds = uniqueIds.slice(0, maxBatch);
    const concurrency = getTranslateConcurrency();

    const results = await mapLimit(messageIds, concurrency, async (messageId) => {
      const raw = getMessageById(messageId);
      if (!raw) {
        return { messageId, error: "Message not found." };
      }
      const row = enrichMessage(raw);
      try {
        const translatedText = await resolveTranslation(row, targetLocale, viewer.id);
        return { messageId, translatedText };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { messageId, error: msg };
      }
    });

    return { results, targetLocale };
  });

  fastify.post("/api/translate", async (request, reply) => {
    const viewer = ensureUser(request, reply);
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const messageId = Number(body.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return reply
        .code(400)
        .send({ error: { code: "VALIDATION_ERROR", message: "Invalid messageId." } });
    }
    const targetLocale =
      typeof body.targetLocale === "string" && body.targetLocale.trim()
        ? body.targetLocale.trim().slice(0, 48)
        : "en";

    const raw = getMessageById(messageId);
    if (!raw) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Message not found." } });
    }
    const row = enrichMessage(raw);
    try {
      const translatedText = await resolveTranslation(row, targetLocale, viewer.id);
      return { translatedText, targetLocale, messageId: row.id };
    } catch (e) {
      request.log.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(502).send({ error: { code: "TRANSLATION_FAILED", message: msg } });
    }
  });
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, concurrency, fn) {
  if (!items.length) {
    return [];
  }
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Value to attach on feed messages for the viewer's locale (no Gemini call).
 * @param {object} row
 * @param {string} viewerUserId
 * @param {string} viewerLocale
 * @returns {string | null}
 */
function feedTranslatedText(row, viewerUserId, viewerLocale) {
  if (typeof row.body === "string" && row.body.startsWith("FILE:")) {
    return row.body.split(":").slice(2).join(":") || "file";
  }
  const cached = getCachedTranslation(row.id, viewerLocale);
  if (cached != null) {
    return cached;
  }
  const isOwnMessage = row.user_id === viewerUserId;
  if (!isOwnMessage && (row.author_locale || "en") === viewerLocale) {
    return row.body;
  }
  return null;
}

/**
 * @param {object} row
 * @param {string} targetLocale
 * @param {string} [viewerUserId] When set, messages written by this user are still translated into targetLocale (no same-locale skip), so own bubbles get a translation line like others.
 */
async function resolveTranslation(row, targetLocale, viewerUserId) {
  if (typeof row.body === "string" && row.body.startsWith("FILE:")) {
    const name = row.body.split(":").slice(2).join(":") || "file";
    return name;
  }

  const cached = getCachedTranslation(row.id, targetLocale);
  if (cached != null) {
    return cached;
  }

  const authorLocale = row.author_locale || "en";
  const isOwnMessage = Boolean(viewerUserId && row.user_id === viewerUserId);
  if (!isOwnMessage && authorLocale === targetLocale) {
    return row.body;
  }

  const key = translationKey(row.id, targetLocale);
  const pending = translationInflight.get(key);
  if (pending) {
    return pending;
  }

  const promise = translateWithGemini(row.body, targetLocale)
    .then((translated) => {
      setCachedTranslation(row.id, targetLocale, translated);
      return translated;
    })
    .finally(() => {
      translationInflight.delete(key);
    });
  translationInflight.set(key, promise);
  return promise;
}
