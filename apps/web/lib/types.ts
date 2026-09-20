import type { Genome } from "./genome";
import type { ProductSpec } from "./market";

/** All money in this project is integer micro-dollars, matching the ERC20's 6 decimals. */
export type Micro = number;
export const MICRO = 1_000_000;
export const usd = (n: number): Micro => Math.round(n * MICRO);
export const toUsd = (m: Micro): number => m / MICRO;

export type AgentStatus = "alive" | "dead";

export type DeathReason =
  "unprofitable" | "out_of_budget" | "killed_by_human" | "outcompeted";

export type TxRef = {
  kind: "spend" | "revenue" | "register" | "reproduce" | "kill";
  hash: string | null;
  amountMicro: Micro;
  memo: string;
  tick: number;
};

export type Creative = {
  headline: string;
  body: string;
  cta: string;
  /**
   * The pitch as the agent says it out loud — one or two sentences of plain speech.
   * Written separately from `body` because text that reads well on a page sounds stilted
   * when a speech synthesiser reads it: no line breaks, no lists, no em dashes.
   */
  spoken: string;
  /**
   * The product photo that ships with this publication.
   *
   * An asset, not an input: no model ever looks at it. The agent decides what to say from
   * the written brief and its own strategy, and the picture rides along with the post the
   * way it would on a real ad. Keeping it out of the prompt is also what makes a local
   * model usable — an image is roughly a thousand prompt tokens, the text is a few hundred.
   */
  imageRef: string | null;
  /** Whether a model wrote this or it came from the deterministic fallback. */
  source: "llm" | "template";
  /** Which tick this publication was written on, so a gallery can order them. */
  tick: number;
  /**
   * The campaign this creative was published under, when the agent had one.
   *
   * Kept on the creative rather than looked up later: an agent can outlive several
   * campaigns, and a publication belongs to the one that was running when it was written.
   */
  adCampaignId: string | null;
};

/** How an agent sounds. Derived from its genome so the voice matches the strategy. */
export type Voice = {
  /** 0.5–2. Urgent strategies talk faster, educational ones slower. */
  rate: number;
  /** 0–2. Separates the agents from each other by ear. */
  pitch: number;
  /** Preferred BCP-47 tag; the browser picks the nearest installed voice. */
  lang: string;
};

export type Agent = {
  id: string;
  label: string;
  address: `0x${string}` | null;
  generation: number;
  parentId: string | null;
  genome: Genome;
  mutatedGenes: string[];

  allowanceMicro: Micro;
  epochCapMicro: Micro;
  spentMicro: Micro;
  revenueMicro: Micro;

  impressions: number;
  clicks: number;
  conversions: number;

  status: AgentStatus;
  bornTick: number;
  diedTick: number | null;
  deathReason: DeathReason | null;

  creative: Creative | null;
  /**
   * Everything this agent has published, newest last.
   *
   * An agent that rewrites its pitch after a bad generation should be able to show both,
   * which is the visible proof that it adapts rather than repeats. Capped, because a long
   * run would otherwise grow the snapshot without bound.
   */
  creatives: Creative[];
  trackingId: string;
  txs: TxRef[];

  /**
   * The ad campaign this agent is running, as the network identifies it.
   *
   * Null until the agent decides to advertise. Stored exactly as a real network's id would
   * be, so nothing upstream cares whether it came from the simulator or from Adsterra.
   */
  adCampaignId: string | null;
  adCampaignStatus: AdCampaignStatus | null;
  /**
   * What the agent chose to spend per tick, as a multiple of its genome's natural rate.
   * Raised when it is making money, cut when it is not — the agent's own lever.
   */
  budgetScale: number;
};

/** Mirrors the ad platform's campaign states, kept here so the view layer can read it. */
export type AdCampaignStatus = "active" | "paused" | "ended";

export type FitnessWeights = {
  /** Weight on raw profit — the default MVP fitness is profit alone. */
  profit: number;
  /** Weight on conversion rate, scaled to money terms. */
  conversionRate: number;
  /** Penalty on cost per acquisition. */
  costPerAcquisition: number;
};

export const PROFIT_ONLY: FitnessWeights = {
  profit: 1,
  conversionRate: 0,
  costPerAcquisition: 0,
};

export type EvolutionConfig = {
  /** Ticks between generation boundaries. */
  ticksPerGeneration: number;
  /** Agents whose fitness falls below this die. */
  survivalThresholdMicro: Micro;
  /** Fraction of the surviving population allowed to reproduce, best first. */
  breedFraction: number;
  /** Children per breeding parent. */
  offspringPerParent: number;
  /** Ceiling on the living population. */
  maxPopulation: number;
  /**
   * Floor on the living population. If selection wipes out too many, fresh random strategies
   * are drafted in — a population that goes extinct stops searching, and a real operator
   * would not accept "everything died, good luck" as an outcome.
   */
  minPopulation: number;
  /** Genes changed per child, at most. */
  mutationGenes: number;
  /**
   * Clicks an agent must have bought before selection is allowed to judge it.
   *
   * Conversions are rare and integral: at low spend a perfectly good strategy can show zero
   * sales for a few days purely by luck. Culling on that is not selection, it is noise, and
   * it wipes out the population before it has learned anything.
   */
  minClicksToJudge: number;
  weights: FitnessWeights;
};

export const DEFAULT_EVOLUTION: EvolutionConfig = {
  ticksPerGeneration: 3,
  survivalThresholdMicro: 0,
  breedFraction: 0.4,
  offspringPerParent: 1,
  maxPopulation: 12,
  minPopulation: 4,
  mutationGenes: 2,
  minClicksToJudge: 400,
  weights: PROFIT_ONLY,
};

export type Campaign = {
  id: string;
  createdAt: string;
  product: ProductSpec;
  images: string[];
  landingUrl: string | null;

  budgetMicro: Micro;
  globalCapMicro: Micro;
  perAgentMicro: Micro;
  epochCapMicro: Micro;

  seed: number;
  tick: number;
  generation: number;
  paused: boolean;

  evolution: EvolutionConfig;

  chain: {
    chainId: number | null;
    treasury: `0x${string}` | null;
    token: `0x${string}` | null;
    campaignId: string | null;
    explorer: string | null;
    live: boolean;
  };

  agents: Agent[];
  events: CampaignEvent[];
};

export type CampaignEvent = {
  tick: number;
  at: string;
  kind:
    | "tick"
    | "birth"
    | "death"
    | "generation"
    | "conversion"
    | "chain"
    | "human";
  agentId: string | null;
  message: string;
  amountMicro?: Micro;
};
