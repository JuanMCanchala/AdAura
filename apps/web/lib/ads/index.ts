import type { Market } from "../market";
import { MockAdPlatform } from "./mock";
import type { AdPlatform } from "./types";

export type AdPlatformName = AdPlatform["name"];

/**
 * Which advertising network this deployment talks to.
 *
 * Defaults to the local simulator so the demo never depends on an outside service being up,
 * funded, or out of moderation. An unrecognised value falls back to the simulator rather
 * than erroring — a typo in an env var should not take the demo down.
 *
 * Adding Adsterra later is one new file implementing `AdPlatform`, plus a branch here.
 * No agent code changes: that is the whole point of the interface.
 */
export function selectedAdPlatformName(): AdPlatformName {
  const raw = (process.env.AD_PLATFORM ?? "").trim().toLowerCase();
  return raw === "adsterra" ? "adsterra" : "mock";
}

export function createAdPlatform(market: Market, seed: number): AdPlatform {
  // Only the simulator exists today. When an AdsterraAdapter lands it is selected here,
  // and everything upstream — agents, tick(), the dashboard — stays exactly as it is.
  return new MockAdPlatform(market, seed);
}

export { MockAdPlatform };
export type { AdPlatform };
export * from "./types";
