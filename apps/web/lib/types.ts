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
  /** Whether a model wrote this or it came from the deterministic fallback. */
  source: "llm" | "template";
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
  trackingId: string;
  txs: TxRef[];
};

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
