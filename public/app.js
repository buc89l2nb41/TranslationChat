import { LOCALES } from "./locales-data.js";

/** Dual curved arrows (translate / exchange). */
const SVG_TRANSLATE_ICON = `<svg class="btn-translate-icon" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;

const displayName = document.getElementById("displayName");
const localeSelect = document.getElementById("locale");
const profileStatus = document.getElementById("profileStatus");
const composer = document.getElementById("composer");
const sendBtn = document.getElementById("sendBtn");
const feedStatus = document.getElementById("feedStatus");
const feedPanel = document.getElementById("feedPanel");
const messagesEl = document.getElementById("messages");
const autoTranslate = document.getElementById("autoTranslate");
const fileInput = document.getElementById("fileInput");
const fileSelectedName = document.getElementById("fileSelectedName");
const fileUploadBtn = document.getElementById("fileUploadBtn");
const fileStatus = document.getElementById("fileStatus");
autoTranslate.checked = true;

/** Match shell height to the visible viewport (mobile URL bar / split view / resized window). */
function syncAppViewportHeight() {
  let h = window.innerHeight;
  if (typeof window.visualViewport !== "undefined" && window.visualViewport.height > 0) {
    h = window.visualViewport.height;
  }
  document.documentElement.style.setProperty("--app-height", `${h}px`);
}

/** @type {Array<{id:number,body:string,translatedText:string,authorName:string,authorLocale:string,createdAt:number,isOwn:boolean}>} */
let feedCache = [];
let maxId = 0;
/** @type {EventSource | null} */
let feedEventSource = null;
let autoTranslateEnabled = true;
/** Incremented to cancel in-flight auto-translate runs (new run or toggle off). */
let autoTranslateGen = 0;
/** Server feed window; client trims to this many newest messages. */
let feedLimit = 50;
/** Max IDs per batch translate request (from server). */
let translateBatchMax = 50;

/** @type {ReturnType<typeof setTimeout> | null} */
let profilePersistTimer = null;

/** @type {Map<number, { status: 'loading' } | { status: 'ok'; text: string } | { status: 'err'; message: string }>} */
const translationByMessageId = new Map();

function isMobileLike() {
  const uaDataMobile =
    typeof navigator !== "undefined" && "userAgentData" in navigator
      ? navigator.userAgentData?.mobile
      : false;
  const coarsePointer =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const uaLooksMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
  return Boolean(uaDataMobile) || (coarsePointer && uaLooksMobile);
}

function setHint(el, text, isError = false) {
  el.textContent = text || "";
  el.classList.toggle("error", Boolean(isError));
}

function syncFileSelectedName() {
  if (!fileSelectedName || !fileInput) {
    return;
  }
  const f = fileInput.files?.[0];
  fileSelectedName.textContent = f ? f.name : "No file selected";
}

function fillLocaleSelect() {
  localeSelect.innerHTML = LOCALES.map(
    (entry) => `<option value="${escapeAttr(entry.value)}">${escapeHtml(entry.label)}</option>`
  ).join("");
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isFileMessageBody(body) {
  return String(body || "").startsWith("FILE:");
}

function renderMessageBody(message) {
  const raw = String(message.body || "");
  if (raw.startsWith("FILE:")) {
    const parts = raw.split(":");
    const id = Number(parts[1]);
    const name = parts.slice(2).join(":") || "file";
    if (Number.isFinite(id) && id > 0) {
      return `<a class="file-link bubble-file-link" href="/api/files/${id}/download" download>${escapeHtml(name)}</a>`;
    }
  }
  return escapeHtml(raw);
}

async function api(path, opts = {}) {
  const headers = { ...opts.headers };
  if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { credentials: "same-origin", ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || res.statusText || "Request failed";
    throw new Error(msg);
  }
  return data;
}

async function loadMe() {
  const { user } = await api("/api/me");
  displayName.value = user.displayName || "";
  const loc = user.locale || "en";
  if ([...localeSelect.options].some((opt) => opt.value === loc)) {
    localeSelect.value = loc;
  } else {
    localeSelect.value = "en";
  }
}

async function persistProfileNow() {
  try {
    await api("/api/me", {
      method: "PATCH",
      body: {
        displayName: displayName.value,
        countryCode: "",
        locale: localeSelect.value || "en",
      },
    });
    setHint(profileStatus, "Saved");
    feedCache = feedCache.map((m) =>
      m.isOwn ? { ...m, authorName: displayName.value.trim() || "" } : m
    );
    renderMessages(false);
  } catch (e) {
    setHint(profileStatus, e instanceof Error ? e.message : String(e), true);
  }
}

function schedulePersistProfile() {
  if (profilePersistTimer) {
    clearTimeout(profilePersistTimer);
  }
  profilePersistTimer = window.setTimeout(() => {
    profilePersistTimer = null;
    void persistProfileNow();
  }, 450);
}

/** When translation target language changes, drop cached lines and re-run auto-translate if enabled. */
function onTranslationTargetLocaleChanged() {
  translationByMessageId.clear();
  autoTranslateGen += 1;
  renderMessages(true);
  if (autoTranslateEnabled) {
    void autoTranslateVisibleMessages();
  }
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString("en", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(ts);
  }
}

function isNearBottom() {
  const el = feedPanel;
  if (!el) {
    return true;
  }
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  return remaining < 72;
}

/** Scroll the feed panel (not #messages) to the latest line; double rAF catches layout after innerHTML. */
function scrollMessagesToBottom(options = {}) {
  let { smooth = false } = options;
  if (
    smooth &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    smooth = false;
  }
  const el = feedPanel;
  if (!el) {
    return;
  }
  const apply = () => {
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };
  apply();
  requestAnimationFrame(() => {
    requestAnimationFrame(apply);
  });
}

function trimFeedToLimit() {
  if (feedCache.length > feedLimit) {
    feedCache = feedCache.slice(-feedLimit);
  }
  const validIds = new Set(feedCache.map((m) => m.id));
  for (const id of translationByMessageId.keys()) {
    if (!validIds.has(id)) {
      translationByMessageId.delete(id);
    }
  }
}

/** Apply server-known translations so the client skips Gemini requests for cache hits. */
function seedTranslationsFromMessages(messages) {
  for (const message of messages) {
    if (typeof message.translatedText === "string") {
      translationByMessageId.set(message.id, { status: "ok", text: message.translatedText });
    }
  }
}

/**
 * @param {number[]} ids
 * @param {number} size
 */
function chunkIds(ids, size) {
  if (size <= 0) {
    return [ids];
  }
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

function renderTranslationBlock(messageId) {
  const state = translationByMessageId.get(messageId);
  if (!state) {
    return "";
  }
  if (state.status === "loading") {
    return `<div class="bubble-translation loading" role="status">Translating...</div>`;
  }
  if (state.status === "err") {
    return `<div class="bubble-translation error" role="alert">${escapeHtml(state.message)}</div>`;
  }
  return `<div class="bubble-translation">${escapeHtml(state.text)}</div>`;
}

function renderMessages(forceScroll = false, scrollOpts = {}) {
  const shouldStickToBottom = forceScroll || isNearBottom();
  if (!feedCache.length) {
    messagesEl.innerHTML = `<p class="empty">No messages yet.</p>`;
    if (shouldStickToBottom) {
      scrollMessagesToBottom(scrollOpts);
    }
    return;
  }

  messagesEl.innerHTML = feedCache
    .map((message) => {
      const who = message.authorName?.trim() || "Anonymous";
      const rowClass = message.isOwn ? "message-row own" : "message-row";
      const bubbleClass = message.isOwn ? "bubble own" : "bubble";
      const transBlock = renderTranslationBlock(message.id);
      const isFile = isFileMessageBody(message.body);
      const translateBtn = isFile
        ? ""
        : `<button type="button" class="btn-translate" data-translate="${message.id}" aria-label="Translate">${SVG_TRANSLATE_ICON}</button>`;
      return `<article class="${rowClass}" data-id="${message.id}">
        <div class="bubble-wrap">
          <div class="bubble-meta"><span>${escapeHtml(who)}</span><span>${formatTime(message.createdAt)}</span></div>
          <div class="bubble-row">
            <p class="${bubbleClass}">${renderMessageBody(message)}</p>
            ${translateBtn}
          </div>
          ${transBlock}
        </div>
      </article>`;
    })
    .join("");

  if (shouldStickToBottom) {
    scrollMessagesToBottom(scrollOpts);
  }
}

async function translateMessage(messageId) {
  const msg = feedCache.find((m) => m.id === messageId);
  if (msg && isFileMessageBody(msg.body)) {
    return;
  }
  const state = translationByMessageId.get(messageId);
  if (state?.status === "loading") {
    return;
  }
  const targetLocale = localeSelect.value || "en";
  translationByMessageId.set(messageId, { status: "loading" });
  renderMessages(true);
  try {
    const { translatedText } = await api("/api/translate", {
      method: "POST",
      body: { messageId, targetLocale },
    });
    translationByMessageId.set(messageId, { status: "ok", text: translatedText });
  } catch (e) {
    translationByMessageId.set(messageId, {
      status: "err",
      message: e instanceof Error ? e.message : String(e),
    });
  }
  renderMessages(true);
}

async function autoTranslateVisibleMessages() {
  const gen = ++autoTranslateGen;
  if (!autoTranslateEnabled) {
    return;
  }

  const targetLocale = localeSelect.value || "en";
  const ids = [];
  for (const message of feedCache) {
    if (isFileMessageBody(message.body)) {
      continue;
    }
    const st = translationByMessageId.get(message.id);
    if (st?.status === "loading" || st?.status === "ok") {
      continue;
    }
    ids.push(message.id);
  }
  if (!ids.length) {
    return;
  }

  for (const id of ids) {
    translationByMessageId.set(id, { status: "loading" });
  }
  renderMessages(true);

  try {
    const chunks = chunkIds(ids, translateBatchMax);
    for (const chunk of chunks) {
      if (!autoTranslateEnabled || gen !== autoTranslateGen) {
        break;
      }
      const { results } = await api("/api/translate/batch", {
        method: "POST",
        body: { messageIds: chunk, targetLocale },
      });
      if (!autoTranslateEnabled || gen !== autoTranslateGen) {
        break;
      }
      for (const r of results) {
        if (r.translatedText !== undefined && r.translatedText !== null) {
          translationByMessageId.set(r.messageId, { status: "ok", text: r.translatedText });
        } else {
          translationByMessageId.set(r.messageId, {
            status: "err",
            message: r.error || "Translation failed",
          });
        }
      }
      renderMessages(true);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const id of ids) {
      const st = translationByMessageId.get(id);
      if (st?.status === "loading") {
        translationByMessageId.set(id, { status: "err", message: msg });
      }
    }
    renderMessages(true);
  }
}

async function loadFeedInitial() {
  setHint(feedStatus, "Loading...");
  sendBtn.disabled = true;
  try {
    const data = await api("/api/feed");
    feedCache = data.messages;
    feedLimit =
      typeof data.feedLimit === "number" && data.feedLimit > 0 ? data.feedLimit : 50;
    translateBatchMax =
      typeof data.translateBatchMax === "number" && data.translateBatchMax > 0
        ? data.translateBatchMax
        : 50;
    maxId = feedCache.reduce((acc, message) => Math.max(acc, message.id), 0);
    trimFeedToLimit();
    seedTranslationsFromMessages(feedCache);
    renderMessages(true);
    if (autoTranslateEnabled) {
      void autoTranslateVisibleMessages();
    }
    setHint(feedStatus, "");
  } catch (e) {
    setHint(feedStatus, e instanceof Error ? e.message : String(e), true);
  } finally {
    sendBtn.disabled = false;
  }
}

/**
 * @param {Array<{id:number,body:string,translatedText:string|null,authorName:string,authorLocale:string,createdAt:number,isOwn:boolean}>} messages
 */
function mergeIncomingMessages(messages) {
  if (!messages.length) {
    return;
  }
  const map = new Map(feedCache.map((message) => [message.id, message]));
  for (const message of messages) {
    map.set(message.id, message);
    maxId = Math.max(maxId, message.id);
  }
  feedCache = [...map.values()].sort((a, b) => a.id - b.id);
  trimFeedToLimit();
  seedTranslationsFromMessages(messages);
  renderMessages(true, { smooth: true });
  if (autoTranslateEnabled) {
    void autoTranslateVisibleMessages();
  }
}

/** After SSE reconnect or missed events: catch up with `since`. If maxId is 0, refresh like full feed. */
async function resyncFeedSince() {
  try {
    if (maxId === 0) {
      const data = await api("/api/feed");
      feedCache = data.messages;
      feedLimit =
        typeof data.feedLimit === "number" && data.feedLimit > 0 ? data.feedLimit : 50;
      translateBatchMax =
        typeof data.translateBatchMax === "number" && data.translateBatchMax > 0
          ? data.translateBatchMax
          : 50;
      maxId = feedCache.reduce((acc, m) => Math.max(acc, m.id), 0);
      trimFeedToLimit();
      seedTranslationsFromMessages(feedCache);
      renderMessages(true);
      if (autoTranslateEnabled) {
        void autoTranslateVisibleMessages();
      }
      return;
    }
    const { messages } = await api(`/api/feed?since=${maxId}`);
    mergeIncomingMessages(messages);
  } catch {
    /* ignore */
  }
}

function connectFeedSse() {
  if (feedEventSource) {
    feedEventSource.close();
    feedEventSource = null;
  }
  const es = new EventSource("/api/feed/stream");
  feedEventSource = es;
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "message" && data.message) {
        mergeIncomingMessages([data.message]);
      }
    } catch {
      /* ignore */
    }
  };
  es.onopen = () => {
    void resyncFeedSince();
  };
}

async function uploadFile() {
  const file = fileInput?.files?.[0];
  if (!file) {
    setHint(fileStatus, "Choose a file first.", true);
    return;
  }
  setHint(fileStatus, "Uploading...");
  if (fileUploadBtn) fileUploadBtn.disabled = true;
  try {
    const form = new FormData();
    form.append("file", file);
    const { file: uploaded } = await api("/api/files", { method: "POST", body: form });
    fileInput.value = "";
    syncFileSelectedName();
    await api("/api/messages", { method: "POST", body: { body: `FILE:${uploaded.id}:${uploaded.name}` } });
    setHint(fileStatus, "");
    await resyncFeedSince();
  } catch (e) {
    setHint(fileStatus, e instanceof Error ? e.message : String(e), true);
  } finally {
    if (fileUploadBtn) fileUploadBtn.disabled = false;
  }
}

async function sendMessage() {
  const text = composer.value.trim();
  if (!text) {
    setHint(feedStatus, "Enter a message.", true);
    return;
  }
  setHint(feedStatus, "Posting...");
  sendBtn.disabled = true;
  try {
    await api("/api/messages", { method: "POST", body: { body: text } });
    composer.value = "";
    resizeComposerHeight();
    await resyncFeedSince();
    setHint(feedStatus, "");
  } catch (e) {
    setHint(feedStatus, e instanceof Error ? e.message : String(e), true);
  } finally {
    sendBtn.disabled = false;
  }
}

function onComposerKeyDown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return;
  }
  if (isMobileLike()) {
    return;
  }
  event.preventDefault();
  void sendMessage();
}

function resizeComposerHeight() {
  if (!composer) {
    return;
  }
  composer.style.height = "auto";
  const maxPx = parseFloat(getComputedStyle(composer).maxHeight);
  const cap = Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 128;
  const next = Math.min(composer.scrollHeight, cap);
  composer.style.height = `${next}px`;
}

messagesEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest("[data-translate]");
  if (!btn) return;
  const id = Number(btn.getAttribute("data-translate"));
  if (!Number.isFinite(id)) return;
  void translateMessage(id);
});
autoTranslate.addEventListener("change", () => {
  autoTranslateEnabled = autoTranslate.checked;
  if (!autoTranslateEnabled) {
    autoTranslateGen += 1;
    for (const [id, st] of translationByMessageId) {
      if (st.status === "loading") {
        translationByMessageId.delete(id);
      }
    }
    renderMessages(true);
    return;
  }
  void autoTranslateVisibleMessages();
});

displayName.addEventListener("input", () => schedulePersistProfile());
displayName.addEventListener("blur", () => {
  if (profilePersistTimer) {
    clearTimeout(profilePersistTimer);
    profilePersistTimer = null;
    void persistProfileNow();
  }
});
localeSelect.addEventListener("change", () => {
  onTranslationTargetLocaleChanged();
  schedulePersistProfile();
});
sendBtn.addEventListener("click", () => void sendMessage());
fileUploadBtn?.addEventListener("click", () => void uploadFile());
fileInput?.addEventListener("change", () => syncFileSelectedName());
composer.addEventListener("keydown", onComposerKeyDown);
composer.addEventListener("input", () => resizeComposerHeight());

fillLocaleSelect();
syncAppViewportHeight();
window.addEventListener("resize", syncAppViewportHeight);
if (typeof window.visualViewport !== "undefined") {
  window.visualViewport.addEventListener("resize", syncAppViewportHeight);
}

async function boot() {
  try {
    await loadMe();
    await loadFeedInitial();
    resizeComposerHeight();
    syncAppViewportHeight();
    connectFeedSse();
  } catch (e) {
    setHint(profileStatus, e instanceof Error ? e.message : String(e), true);
  }
}

void boot();
