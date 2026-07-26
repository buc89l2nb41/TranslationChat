/**
 * Runs before server start (npm prestart): clears data/uploads and deletes `files` rows.
 * Skipped if you run `node server/index.js` only; prefer `npm start`.
 */
import fs from "node:fs";
import path from "node:path";
import { db, dataDir } from "./db.js";

const uploadsDir = path.join(dataDir, "uploads");

if (fs.existsSync(uploadsDir)) {
  for (const name of fs.readdirSync(uploadsDir)) {
    const p = path.join(uploadsDir, name);
    const st = fs.statSync(p);
    if (st.isFile()) {
      fs.unlinkSync(p);
    } else if (st.isDirectory()) {
      fs.rmSync(p, { recursive: true });
    }
  }
} else {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

try {
  db.exec("DELETE FROM files");
} catch {
  /* Table may not exist yet */
}

try {
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'files'");
} catch {
  /* May be missing */
}

console.log("[trans] Cleaned data/uploads and files table (session reset for uploads).");
