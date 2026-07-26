/**
 * For dev / internal testing: returns a placeholder without real translation (reflects direction and tone).
 */
export function getStubAdapter(_cfg) {
  return {
    async translate(req) {
      const { text, sourceLocale, targetLocale, tone, domain } = req;
      const domainBit = domain ? ` [${domain}]` : "";
      return `[stub] ${sourceLocale}→${targetLocale} (${tone})${domainBit}: ${text}`;
    },
  };
}
