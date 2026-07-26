/**
 * Chat feed messages: visible via /api/feed while running; not written to DB or files.
 * Lives in process memory only, so it is cleared on restart/deploy.
 * Translation output is not cached on the server either.
 */

/** @type {Array<{ id: number, userId: string, body: string, createdAt: number }>} */
const messages = [];

/** @type {Set<(m: { id: number, userId: string, body: string, createdAt: number }) => void>} */
const messageListeners = new Set();

let nextId = 1;

/**
 * Called for each new message (e.g. SSE broadcast).
 * @param {(m: { id: number, userId: string, body: string, createdAt: number }) => void} fn
 * @returns {() => void}
 */
export function onMessageAdded(fn) {
  messageListeners.add(fn);
  return () => messageListeners.delete(fn);
}

/** Max messages kept in the feed for a session (oldest dropped first). */
const MAX_MESSAGES = 100;

/**
 * @param {string} userId
 * @param {string} body
 * @returns {{ id: number, createdAt: number }}
 */
export function addMessage(userId, body) {
  const createdAt = Date.now();
  const id = nextId++;
  const msg = { id, userId, body, createdAt };
  messages.push(msg);
  while (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
  for (const listener of messageListeners) {
    try {
      listener(msg);
    } catch {
      /* ignore subscriber errors */
    }
  }
  return { id, createdAt };
}

/**
 * @param {number} sinceId
 * @returns {typeof messages}
 */
export function listMessagesAfter(sinceId) {
  return messages.filter((m) => m.id > sinceId).sort((a, b) => a.id - b.id);
}

/**
 * @returns {typeof messages}
 */
export function listRecentMessages(limit) {
  if (messages.length <= limit) return [...messages];
  return messages.slice(-limit);
}

/**
 * @param {number} id
 * @returns {{ id: number, userId: string, body: string, createdAt: number } | undefined}
 */
export function getMessageById(id) {
  return messages.find((m) => m.id === id);
}
