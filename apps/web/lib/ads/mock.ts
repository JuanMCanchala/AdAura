import type { Market } from "../market";
import { type Rng, mulberry32 } from "../rng";
import type { Micro } from "../types";
import type {
  AdCampaign,
  AdClick,
  AdPlatform,
  AdStats,
  CreateCampaignInput,
  DeliveryResult,
} from "./types";

/**
 * A local advertising network.
 *
 * It is a simulator and the UI says so. What it is *not* is a shortcut: it does not invent
 * conversions. It sells impressions, turns some of them into clicks, and hands those clicks
 * back one by one. Whether a click becomes a sale is decided downstream, by the same landing
 * page a real visitor would hit — so the attribution path the demo shows is the real one.
 *
 * The delivery model is the existing `market.ts`, reused rather than reimplemented: it
 * already holds a hidden per-strategy truth that agents can only discover by spending, and
 * `npm run sim` already proves a population climbs it. Wrapping it keeps that guarantee.
 */

/** Campaign state plus the counters a network would keep for it. */
type Entry = {
  campaign: AdCampaign;
  /** Kept so delivery can price and target the same way every tick. */
  genome: CreateCampaignInput["genome"];
  impressions: number;
  clicks: number;
  conversions: number;
  spendMicro: Micro;
  revenueMicro: Micro;
  /** Clicks delivered but not yet resolved, so a conversion can be attributed later. */
  openClicks: Map<string, AdClick>;
};

export class MockAdPlatform implements AdPlatform {
  readonly name = "mock" as const;

  private readonly campaigns = new Map<string, Entry>();
  private readonly market: Market;
  private readonly rng: Rng;
  private counter = 0;

  /**
   * Seeded on purpose. A pitch cannot depend on a coin flip: the same seed replays the same
   * market, so a rehearsed demo behaves on stage the way it behaved in rehearsal.
   */
  constructor(market: Market, seed: number) {
    this.market = market;
    this.rng = mulberry32(seed ^ 0xad0);
  }

  /** Looks like a network id, and is stable for a given seed and call order. */
  private nextId(prefix: string): string {
    this.counter += 1;
    const n = Math.floor(this.rng() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
    return `${prefix}_${n}${this.counter.toString(16)}`;
  }

  private require(campaignId: string): Entry {
    const e = this.campaigns.get(campaignId);
    if (!e) throw new Error(`Unknown campaign ${campaignId}.`);
    return e;
  }

  async createCampaign(input: CreateCampaignInput): Promise<AdCampaign> {
    const campaign: AdCampaign = {
      campaignId: this.nextId("mock_campaign"),
      agentId: input.agentId,
      destinationUrl: input.destinationUrl,
      budgetMicro: input.budgetMicro,
      dailyBudgetMicro: input.dailyBudgetMicro,
      // What the strategy is willing to pay per thousand impressions, from the bid gene.
      bidMicro: this.market.cpmFor(input.genome),
      status: "active",
      createdTick: input.tick,
    };
    this.campaigns.set(campaign.campaignId, {
      campaign,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      spendMicro: 0,
      revenueMicro: 0,
      openClicks: new Map(),
      genome: input.genome,
    });
    return campaign;
  }

  async getCampaign(campaignId: string): Promise<AdCampaign | null> {
    return this.campaigns.get(campaignId)?.campaign ?? null;
  }

  async updateBudget(
    campaignId: string,
    dailyBudgetMicro: Micro,
  ): Promise<AdCampaign> {
    const e = this.require(campaignId);
    e.campaign.dailyBudgetMicro = Math.max(0, Math.round(dailyBudgetMicro));
    return e.campaign;
  }

  async pauseCampaign(campaignId: string): Promise<AdCampaign> {
    const e = this.require(campaignId);
    // Ended is terminal; pausing a finished campaign should not resurrect it.
    if (e.campaign.status !== "ended") e.campaign.status = "paused";
    return e.campaign;
  }

  async resumeCampaign(campaignId: string): Promise<AdCampaign> {
    const e = this.require(campaignId);
    if (e.campaign.status === "paused") e.campaign.status = "active";
    return e.campaign;
  }

  async endCampaign(campaignId: string): Promise<AdCampaign> {
    const e = this.require(campaignId);
    e.campaign.status = "ended";
    return e.campaign;
  }

  /**
   * Buy one tick of traffic.
   *
   * A paused or exhausted campaign delivers nothing — the same way a real one stops when you
   * switch it off or its budget runs out. Spend is what the impressions actually cost at the
   * campaign's CPM, never a number picked to make the demo look good.
   */
  async deliver(campaignId: string, tick: number): Promise<DeliveryResult> {
    const e = this.require(campaignId);
    const empty: DeliveryResult = {
      campaignId,
      impressions: 0,
      clicks: [],
      spendMicro: 0,
    };
    if (e.campaign.status !== "active") return empty;

    const remaining = Math.max(0, e.campaign.budgetMicro - e.spendMicro);
    const want = Math.min(e.campaign.dailyBudgetMicro, remaining);
    // Impressions are whole, so a campaign rarely spends its budget to the last micro-dollar.
    // Treat a remainder too small to buy meaningful traffic as spent, or the campaign would
    // sit "active" forever delivering almost nothing.
    if (want <= 0 || want < e.campaign.bidMicro) {
      // Out of budget is out of the auction; say so by ending it.
      e.campaign.status = "ended";
      return empty;
    }

    const served = this.market.serveAds(e.genome, want, this.rng);

    e.impressions += served.impressions;
    e.clicks += served.clicks;
    e.spendMicro += served.spendMicro;

    // Hand back individual clicks. The caller decides which convert, by walking the same
    // landing-page path a real visitor takes — the simulator never converts on its own.
    const clicks: AdClick[] = [];
    for (let i = 0; i < served.clicks; i++) {
      const click: AdClick = {
        clickId: this.nextId("click"),
        campaignId,
        agentId: e.campaign.agentId,
        contributionMicro: served.contributionMicro,
        tick,
      };
      e.openClicks.set(click.clickId, click);
      clicks.push(click);
    }

    return {
      campaignId,
      impressions: served.impressions,
      clicks,
      spendMicro: served.spendMicro,
    };
  }

  /** The simulator's equivalent of an S2S postback: a sale, attributed to one click. */
  async recordConversion(clickId: string, revenueMicro: Micro): Promise<void> {
    for (const e of this.campaigns.values()) {
      const click = e.openClicks.get(clickId);
      if (!click) continue;
      e.openClicks.delete(clickId);
      e.conversions += 1;
      e.revenueMicro += revenueMicro;
      return;
    }
    throw new Error(`Unknown click ${clickId}.`);
  }

  async getStats(campaignId: string): Promise<AdStats | null> {
    const e = this.campaigns.get(campaignId);
    if (!e) return null;
    return {
      campaignId,
      impressions: e.impressions,
      clicks: e.clicks,
      conversions: e.conversions,
      spendMicro: e.spendMicro,
      revenueMicro: e.revenueMicro,
      ctr: e.impressions === 0 ? 0 : e.clicks / e.impressions,
      conversionRate: e.clicks === 0 ? 0 : e.conversions / e.clicks,
    };
  }
}
