import {
  type Agent,
  type Campaign,
  type CampaignEvent,
  type EvolutionConfig,
  type Micro,
  MICRO,
  toUsd,
} from "./types";
import { DEFAULT_EVOLUTION } from "./types";
import { type Market, type ProductSpec, BID, createMarket } from "./market";
import { type Rng, mulberry32 } from "./rng";
import { describe } from "./genome";
import {
  livingAgents,
  populationStats,
  remainingAllowance,
  runGeneration,
  seedPopulation,
} from "./evolution";

/**
 * The loop. One tick is one trading day for the population: every living agent buys as much
 * advertising as its budget allows, the market answers with clicks and sales, and every so
 * many ticks the generation boundary decides who lives.
 */

export type CampaignInput = {
  product: ProductSpec;
  images?: string[];
  landingUrl?: string | null;
  budgetUsd: number;
  perAgentUsd: number;
  epochCapUsd: number;
  populationSize: number;
  seed?: number;
  evolution?: Partial<EvolutionConfig>;
};

export function createCampaign(input: CampaignInput): {
  campaign: Campaign;
  market: Market;
} {
  const seed = input.seed ?? Math.floor(Math.random() * 2 ** 31);
  const rng = mulberry32(seed);

  const campaign: Campaign = {
    id: `camp_${seed.toString(36)}`,
    createdAt: new Date().toISOString(),
    product: input.product,
    images: input.images ?? [],
    landingUrl: input.landingUrl ?? null,

    budgetMicro: Math.round(input.budgetUsd * MICRO),
    globalCapMicro: Math.round(input.budgetUsd * MICRO),
    perAgentMicro: Math.round(input.perAgentUsd * MICRO),
    epochCapMicro: Math.round(input.epochCapUsd * MICRO),

    seed,
    tick: 0,
    generation: 0,
    paused: false,

    evolution: { ...DEFAULT_EVOLUTION, ...input.evolution },

    chain: {
      chainId: null,
      treasury: null,
      token: null,
      campaignId: null,
      explorer: null,
      live: false,
    },

    agents: [],
    events: [],
  };

  campaign.agents = seedPopulation(campaign, input.populationSize, rng);
  for (const a of campaign.agents) {
    log(
      campaign,
      "birth",
      a.id,
      `${a.label} born into generation 0 — ${describe(a.genome)}`,
    );
  }

  return { campaign, market: createMarket(input.product, seed) };
}

/** What an agent intends to spend this tick, before any ceiling is applied. */
export function plannedSpend(agent: Agent, campaign: Campaign): Micro {
  const intensity = BID[agent.genome.bid].spendShare;
  const wanted = Math.round(agent.epochCapMicro * intensity);

  const globalRemaining = Math.max(
    0,
    campaign.globalCapMicro - totalSpent(campaign),
  );
  return Math.max(
    0,
    Math.min(
      wanted,
      remainingAllowance(agent),
      agent.epochCapMicro,
      globalRemaining,
    ),
  );
}

export function totalSpent(campaign: Campaign): Micro {
  return campaign.agents.reduce((s, a) => s + a.spentMicro, 0);
}

export type TickReport = {
  tick: number;
  generationRan: boolean;
  activity: Array<{
    agentId: string;
    spendMicro: Micro;
    impressions: number;
    clicks: number;
    conversions: number;
    revenueMicro: Micro;
  }>;
  births: string[];
  deaths: Array<{ agentId: string; reason: string }>;
};

/**
 * Advance the simulation one tick.
 *
 * `onSpend` and `onRevenue` are where the chain plugs in: the web app passes handlers that
 * call AgentTreasury.spend() from the agent's own wallet and recordRevenue() from the
 * oracle. Headless runs leave them out and the economics stay identical.
 */
export async function tick(
  campaign: Campaign,
  market: Market,
  rng: Rng,
  hooks: {
    onSpend?: (
      agent: Agent,
      amountMicro: Micro,
      memo: string,
    ) => Promise<string | null>;
    onRevenue?: (
      agent: Agent,
      amountMicro: Micro,
      conversionId: string,
    ) => Promise<string | null>;
  } = {},
): Promise<TickReport> {
  const report: TickReport = {
    tick: campaign.tick + 1,
    generationRan: false,
    activity: [],
    births: [],
    deaths: [],
  };

  if (campaign.paused) {
    log(
      campaign,
      "human",
      null,
      "Tick skipped — campaign paused by the operator",
    );
    return report;
  }

  for (const agent of livingAgents(campaign)) {
    const spendMicro = plannedSpend(agent, campaign);
    if (spendMicro <= 0) continue;

    const memo = `t${report.tick}:${agent.genome.platform}`;
    const spendTx = hooks.onSpend
      ? await hooks.onSpend(agent, spendMicro, memo)
      : null;

    agent.spentMicro += spendMicro;
    agent.txs.push({
      kind: "spend",
      hash: spendTx,
      amountMicro: spendMicro,
      memo,
      tick: report.tick,
    });

    const result = market.serveAds(agent.genome, spendMicro, rng);
    agent.impressions += result.impressions;
    agent.clicks += result.clicks;
    agent.conversions += result.conversions;

    if (result.revenueMicro > 0) {
      const conversionId = `${agent.trackingId}-t${report.tick}`;
      const revTx = hooks.onRevenue
        ? await hooks.onRevenue(agent, result.revenueMicro, conversionId)
        : null;

      agent.revenueMicro += result.revenueMicro;
      agent.txs.push({
        kind: "revenue",
        hash: revTx,
        amountMicro: result.revenueMicro,
        memo: conversionId,
        tick: report.tick,
      });
      log(
        campaign,
        "conversion",
        agent.id,
        `${agent.label} converted ${result.conversions}x for $${toUsd(result.revenueMicro).toFixed(2)}`,
        result.revenueMicro,
      );
    }

    report.activity.push({
      agentId: agent.id,
      spendMicro,
      impressions: result.impressions,
      clicks: result.clicks,
      conversions: result.conversions,
      revenueMicro: result.revenueMicro,
    });
  }

  campaign.tick = report.tick;

  if (campaign.tick % campaign.evolution.ticksPerGeneration === 0) {
    const outcome = runGeneration(campaign, rng);
    report.generationRan = true;

    for (const { agent, reason, fitness } of outcome.killed) {
      report.deaths.push({ agentId: agent.id, reason });
      log(
        campaign,
        "death",
        agent.id,
        `${agent.label} shut down (${reason}) — fitness $${toUsd(fitness).toFixed(2)}`,
        fitness,
      );
    }

    campaign.agents.push(...outcome.born);
    for (const child of outcome.born) {
      report.births.push(child.id);
      const parent = campaign.agents.find((a) => a.id === child.parentId);
      log(
        campaign,
        "birth",
        child.id,
        `${child.label} born from ${parent?.label ?? child.parentId} — mutated ${child.mutatedGenes.join(", ") || "nothing"}`,
      );
    }

    const stats = populationStats(campaign);
    log(
      campaign,
      "generation",
      null,
      `Generation ${outcome.generation}: ${stats.alive} alive, ${stats.dead} dead, population profit $${toUsd(stats.profitMicro).toFixed(2)}`,
      stats.profitMicro,
    );
  }

  return report;
}

export function log(
  campaign: Campaign,
  kind: CampaignEvent["kind"],
  agentId: string | null,
  message: string,
  amountMicro?: Micro,
): void {
  campaign.events.push({
    tick: campaign.tick,
    at: new Date().toISOString(),
    kind,
    agentId,
    message,
    amountMicro,
  });
  if (campaign.events.length > 2000)
    campaign.events.splice(0, campaign.events.length - 2000);
}

/** Parent -> children, for drawing the lineage tree. */
export function lineage(campaign: Campaign): Map<string | null, Agent[]> {
  const byParent = new Map<string | null, Agent[]>();
  for (const a of campaign.agents) {
    const list = byParent.get(a.parentId) ?? [];
    list.push(a);
    byParent.set(a.parentId, list);
  }
  return byParent;
}
