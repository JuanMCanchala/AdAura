import type { Agent, Campaign } from "./types";
import { toUsd } from "./types";
import { describe } from "./genome";
import { conversionRateOf, profitOf, roiOf } from "./evolution";

/** The shape the browser gets: money already converted to dollars, no bigints, no maps. */
export type AgentView = {
  id: string;
  label: string;
  address: string | null;
  generation: number;
  parentId: string | null;
  status: "alive" | "dead";
  strategy: string;
  /** What /buy/[tracking] keys off, so the dashboard can link to the storefront. */
  trackingId: string;
  genome: Agent["genome"];
  mutatedGenes: string[];
  deathReason: string | null;

  allowanceUsd: number;
  spentUsd: number;
  revenueUsd: number;
  profitUsd: number;
  roi: number;

  impressions: number;
  clicks: number;
  conversions: number;
  conversionRate: number;

  isChampion: boolean;
  txs: Array<{
    kind: string;
    hash: string | null;
    amountUsd: number;
    memo: string;
    tick: number;
  }>;
};

export type CampaignView = {
  id: string;
  productName: string;
  priceUsd: number;
  tick: number;
  generation: number;
  paused: boolean;
  budgetUsd: number;
  globalCapUsd: number;
  spentUsd: number;
  revenueUsd: number;
  profitUsd: number;
  conversions: number;
  alive: number;
  dead: number;
  total: number;
  roi: number;
  chain: Campaign["chain"];
  agents: AgentView[];
  events: Campaign["events"];
};

export function toView(campaign: Campaign): CampaignView {
  const spent = campaign.agents.reduce((s, a) => s + a.spentMicro, 0);
  const revenue = campaign.agents.reduce((s, a) => s + a.revenueMicro, 0);

  const living = campaign.agents.filter((a) => a.status === "alive");
  const champion = [...living].sort((a, b) => profitOf(b) - profitOf(a))[0];

  return {
    id: campaign.id,
    productName: campaign.product.name,
    priceUsd: campaign.product.priceUsd,
    tick: campaign.tick,
    generation: campaign.generation,
    paused: campaign.paused,
    budgetUsd: toUsd(campaign.budgetMicro),
    globalCapUsd: toUsd(campaign.globalCapMicro),
    spentUsd: toUsd(spent),
    revenueUsd: toUsd(revenue),
    profitUsd: toUsd(revenue - spent),
    conversions: campaign.agents.reduce((s, a) => s + a.conversions, 0),
    alive: living.length,
    dead: campaign.agents.length - living.length,
    total: campaign.agents.length,
    roi: spent === 0 ? 0 : (revenue - spent) / spent,
    chain: campaign.chain,
    events: campaign.events.slice(-60).reverse(),
    agents: campaign.agents.map((a) => ({
      id: a.id,
      label: a.label,
      address: a.address,
      generation: a.generation,
      parentId: a.parentId,
      status: a.status,
      strategy: describe(a.genome),
      trackingId: a.trackingId,
      genome: a.genome,
      mutatedGenes: a.mutatedGenes,
      deathReason: a.deathReason,
      allowanceUsd: toUsd(a.allowanceMicro),
      spentUsd: toUsd(a.spentMicro),
      revenueUsd: toUsd(a.revenueMicro),
      profitUsd: toUsd(profitOf(a)),
      roi: roiOf(a),
      impressions: a.impressions,
      clicks: a.clicks,
      conversions: a.conversions,
      conversionRate: conversionRateOf(a),
      isChampion: champion?.id === a.id && profitOf(a) > 0,
      txs: a.txs.map((t) => ({
        kind: t.kind,
        hash: t.hash,
        amountUsd: toUsd(t.amountMicro),
        memo: t.memo,
        tick: t.tick,
      })),
    })),
  };
}

export function money(usd: number, withSign = false): string {
  const sign = withSign && usd > 0 ? "+" : usd < 0 ? "−" : "";
  return `${sign}$${Math.abs(usd).toFixed(2)}`;
}

export function percent(fraction: number): string {
  const sign = fraction > 0 ? "+" : fraction < 0 ? "−" : "";
  return `${sign}${Math.abs(fraction * 100).toFixed(0)}%`;
}

export const DEATH_REASONS: Record<string, string> = {
  unprofitable: "spent more than it earned",
  out_of_budget: "ran out of budget",
  killed_by_human: "shut down by you",
  outcompeted: "outcompeted",
};
