import type { Genome } from "../genome";
import type { Micro } from "../types";

/**
 * The contract every advertising network implements.
 *
 * An agent asks for a campaign, adjusts its budget, pauses it, and reads back what it
 * bought. It never learns whether the other side is a local simulator or a real network —
 * which is the point: swapping `AD_PLATFORM` must not touch a line of agent logic.
 *
 * The method set is deliberately the intersection of what a real self-serve ad API offers
 * (Adsterra's v3 is the reference: POST a campaign, PATCH its status and budget, GET stats)
 * so the future adapter is a translation layer, not a redesign.
 */

export type { AdCampaignStatus } from "../types";
import type { AdCampaignStatus } from "../types";

/** What the platform hands back when a campaign is created. Opaque to the agent. */
export type AdCampaign = {
  /** The network's own id. Agents persist it exactly as they would a real one. */
  campaignId: string;
  agentId: string;
  /** Where a click lands. Carries the agent's tracking id, as on a real network. */
  destinationUrl: string;
  /** Total the campaign may ever spend. */
  budgetMicro: Micro;
  /** Ceiling for one tick, mirroring a daily cap. */
  dailyBudgetMicro: Micro;
  /** CPM the agent is willing to pay, derived from its genome's bid gene. */
  bidMicro: Micro;
  status: AdCampaignStatus;
  createdTick: number;
};

/** Everything a network will tell you about a campaign's performance so far. */
export type AdStats = {
  campaignId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spendMicro: Micro;
  /**
   * Revenue is normally the advertiser's own number — a real network only knows what you
   * post back to it. The simulator reports it for convenience; an adapter may return 0.
   */
  revenueMicro: Micro;
  /** clicks / impressions. 0 when nothing was served. */
  ctr: number;
  /** conversions / clicks. 0 when nothing was clicked. */
  conversionRate: number;
};

/** One click the network delivered, before it is known whether it converted. */
export type AdClick = {
  clickId: string;
  campaignId: string;
  agentId: string;
  /** The value this click carries if it converts. */
  contributionMicro: Micro;
  tick: number;
};

export type CreateCampaignInput = {
  agentId: string;
  /** Used by the simulator to price and target; an adapter maps it to real targeting. */
  genome: Genome;
  destinationUrl: string;
  budgetMicro: Micro;
  dailyBudgetMicro: Micro;
  tick: number;
};

/**
 * One tick's worth of delivery.
 *
 * `clicks` are handed back individually rather than as a count so the caller can route them
 * through the real landing-page flow instead of having the network invent conversions.
 */
export type DeliveryResult = {
  campaignId: string;
  impressions: number;
  clicks: AdClick[];
  spendMicro: Micro;
};

export type AdPlatform = {
  /** Stable id for logs, the API response and env config. */
  readonly name: "mock" | "adsterra";

  createCampaign(input: CreateCampaignInput): Promise<AdCampaign>;
  getCampaign(campaignId: string): Promise<AdCampaign | null>;
  /** Budget changes are how an agent scales up or down without stopping. */
  updateBudget(campaignId: string, dailyBudgetMicro: Micro): Promise<AdCampaign>;
  pauseCampaign(campaignId: string): Promise<AdCampaign>;
  resumeCampaign(campaignId: string): Promise<AdCampaign>;
  endCampaign(campaignId: string): Promise<AdCampaign>;

  /**
   * Buy one tick of traffic. A real adapter would poll the network's stats endpoint here
   * instead, since delivery happens on their side; the shape of the answer is the same.
   */
  deliver(campaignId: string, tick: number): Promise<DeliveryResult>;

  /** Tell the network a click turned into a sale. Adsterra's S2S postback maps onto this. */
  recordConversion(clickId: string, revenueMicro: Micro): Promise<void>;

  getStats(campaignId: string): Promise<AdStats | null>;
};
