import { getStubAdapter } from "./stubAdapter.js";
import { getHttpAdapter } from "./httpAdapter.js";

/**
 * @param {ReturnType<import("../config.js").getTransConfig>} cfg
 */
export function createAdapter(cfg) {
  const kind = (cfg.adapter || "stub").toLowerCase();
  if (kind === "http") return getHttpAdapter(cfg);
  return getStubAdapter(cfg);
}
