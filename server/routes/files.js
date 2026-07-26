import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import { db, dataDir } from "../db.js";

const COOKIE_NAME = "trans_uid";

/**
 * Uploads: bytes in data/uploads/, metadata in SQLite `files`.
 * Chat shows them only as FILE:id:name links. Pre-start cleanup: server/clean-uploads.mjs (npm prestart).
 */

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
  db.prepare("INSERT INTO users (id, display_name, country_code, locale, created_at) VALUES (?,?,?,?,?)").run(
    id,
    "",
    "",
    "en",
    now
  );
  reply.setCookie(COOKIE_NAME, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    signed: false,
    maxAge: 60 * 60 * 24 * 400,
  });
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getUploadsDir() {
  const dir = path.join(dataDir, "uploads");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * @param {import("fastify").FastifyInstance} fastify
 */
export async function registerFileRoutes(fastify) {
  await fastify.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });

  fastify.post("/api/files", async (request, reply) => {
    const viewer = ensureUser(request, reply);
    const part = await request.file();
    if (!part) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "No file to upload. Use multipart form-data with a field named `file`.",
        },
      });
    }

    const originalName = String(part.filename || "upload").slice(0, 255);
    const storedName = `${Date.now()}-${randomUUID()}`;
    const filePath = path.join(getUploadsDir(), storedName);

    let sizeBytes = 0;

    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(filePath, { flags: "wx" });
        part.file.on("data", (buf) => {
          sizeBytes += buf.length;
        });
        part.file.on("error", reject);
        out.on("error", reject);
        out.on("finish", resolve);
        part.file.pipe(out);
      });
    } catch (e) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: { code: "UPLOAD_FAILED", message: msg } });
    }

    const createdAt = Date.now();
    const mimeType = normalizeStoredMime(originalName, String(part.mimetype || ""));

    const info = db
      .prepare(
        "INSERT INTO files (user_id, original_name, stored_name, mime_type, size_bytes, created_at) VALUES (?,?,?,?,?,?)"
      )
      .run(viewer.id, originalName, storedName, mimeType, sizeBytes, createdAt);

    const id = Number(info.lastInsertRowid);
    return reply.code(201).send({
      file: {
        id,
        name: originalName,
        mime: mimeType,
        sizeBytes,
        createdAt,
        downloadUrl: `/api/files/${id}/download`,
      },
    });
  });

  fastify.get("/api/files/:id/download", async (request, reply) => {
    const viewer = ensureUser(request, reply);
    const id = Number(request.params?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid id." } });
    }
    const row = db.prepare("SELECT * FROM files WHERE id = ?").get(id);
    if (!row || row.user_id !== viewer.id) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "File not found." } });
    }
    const filePath = path.join(getUploadsDir(), row.stored_name);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Stored file missing." } });
    }

    reply.header("Content-Disposition", `attachment; filename="${encodeRFC5987ValueChars(row.original_name)}"`);
    reply.type(resolveDownloadContentType(row.original_name, row.mime_type));
    return reply.send(fs.createReadStream(filePath));
  });
}

function mimeFromExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".zip": "application/zip",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };
  return map[ext] || "";
}

function normalizeStoredMime(originalName, reported) {
  const fromExt = mimeFromExtension(originalName);
  const r = reported.toLowerCase().split(";")[0].trim();
  if (fromExt) {
    const suspicious =
      !r ||
      r === "application/octet-stream" ||
      r === "application/json" ||
      (fromExt === "text/csv" &&
        r !== "text/csv" &&
        r !== "text/comma-separated-values" &&
        r !== "text/plain");
    if (suspicious) {
      return fromExt;
    }
  }
  return r || fromExt || "application/octet-stream";
}

function resolveDownloadContentType(originalName, storedMime) {
  const fromExt = mimeFromExtension(originalName);
  const s = (storedMime || "").toLowerCase().split(";")[0].trim();
  if (fromExt) {
    const bogus =
      !s ||
      s === "application/octet-stream" ||
      (s === "application/json" && fromExt !== "application/json") ||
      (fromExt === "text/csv" && s !== "text/csv" && s !== "text/comma-separated-values");
    if (bogus) {
      return withCharsetIfText(fromExt);
    }
  }
  if (!s) {
    return "application/octet-stream";
  }
  if (s === "application/json" && fromExt && fromExt !== "application/json") {
    return withCharsetIfText(fromExt);
  }
  return withCharsetIfText(storedMime);
}

function withCharsetIfText(mime) {
  const s = String(mime).trim();
  if (/charset\s*=/i.test(s)) {
    return s;
  }
  const base = s.split(";")[0].trim();
  if (base.startsWith("text/") || base === "application/json" || base === "application/javascript") {
    return `${base}; charset=utf-8`;
  }
  return base;
}

function encodeRFC5987ValueChars(str) {
  return String(str)
    .replace(/["\\]/g, "_")
    .replace(/[\r\n]/g, " ")
    .slice(0, 180);
}
