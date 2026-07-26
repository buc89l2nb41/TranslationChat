const HANGUL = /[\uAC00-\uD7AF]/;

/**
 * @param {string} text
 * @param {string} localeA
 * @param {string} localeB
 * @returns {string | null} one of localeA, localeB, or null if empty
 */
export function detectLocale(text, localeA, localeB) {
  const t = (text || "").trim();
  if (!t) return null;
  const hasHangul = HANGUL.test(t);
  const hasLatin = /[a-zA-Z]/.test(t);

  if (hasHangul && (localeA === "ko" || localeB === "ko")) return "ko";
  if (hasLatin && !hasHangul && (localeA === "en" || localeB === "en")) return "en";
  if (hasHangul) return localeA === "ko" ? "ko" : localeB === "ko" ? "ko" : localeA;
  return localeA === "en" ? "en" : localeB === "en" ? "en" : localeA;
}

/**
 * @param {{ sourceLocale: string, targetLocale: string }} pair
 * @param {string | undefined} sourceHint
 * @param {string | undefined} targetHint
 * @param {string} text
 */
export function resolveDirection(pair, sourceHint, targetHint, text) {
  const { sourceLocale: a, targetLocale: b } = pair;

  if (sourceHint && targetHint && sourceHint !== targetHint) {
    return { source: sourceHint, target: targetHint };
  }

  if (sourceHint && (sourceHint === a || sourceHint === b)) {
    const target = sourceHint === a ? b : a;
    return { source: sourceHint, target };
  }

  if (targetHint && (targetHint === a || targetHint === b)) {
    const source = targetHint === a ? b : a;
    return { source, target: targetHint };
  }

  const detected = detectLocale(text, a, b);
  const source = detected || a;
  const target = source === a ? b : a;
  return { source, target };
}
