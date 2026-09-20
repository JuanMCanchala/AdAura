import { describe, expect, it } from "vitest";
import { createAdPlatform, selectedAdPlatformName } from "./index";
import { randomGenome } from "../genome";
import { createMarket } from "../market";
import { mulberry32 } from "../rng";
import { usd } from "../types";
import type { AdPlatform, CreateCampaignInput } from "./types";

/**
 * The simulator has to behave like a network an agent could be wrong about: it sells what
 * was asked for, stops when told to, and never decides on its own that a click was a sale.
 */

const PRODUCT = {
  name: "Aurora Sleep Mask",
  priceUsd: 49,
  margin: 0.62,
  category: "wellness",
};

function platform(seed = 42): AdPlatform {
  return createAdPlatform(createMarket(PRODUCT, seed), seed);
}

function input(overrides: Partial<CreateCampaignInput> = {}): CreateCampaignInput {
  return {
    agentId: "agent_001",
    genome: randomGenome(mulberry32(7)),
    destinationUrl: "https://example.test/buy/camp_1-agent_001",
    budgetMicro: usd(2100),
    dailyBudgetMicro: usd(175),
    tick: 1,
    ...overrides,
  };
}

describe("campaign lifecycle", () => {
  it("creates a campaign with a network-style id and active status", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    expect(c.campaignId).toMatch(/^mock_campaign_/);
    expect(c.status).toBe("active");
    expect(c.agentId).toBe("agent_001");
    // The bid comes from the genome, not from a constant.
    expect(c.bidMicro).toBeGreaterThan(0);
    expect(await p.getCampaign(c.campaignId)).toEqual(c);
  });

  it("pauses, resumes and ends", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    expect((await p.pauseCampaign(c.campaignId)).status).toBe("paused");
    expect((await p.resumeCampaign(c.campaignId)).status).toBe("active");
    expect((await p.endCampaign(c.campaignId)).status).toBe("ended");
    // Ended is terminal: a paused/resumed call must not revive it.
    expect((await p.pauseCampaign(c.campaignId)).status).toBe("ended");
    expect((await p.resumeCampaign(c.campaignId)).status).toBe("ended");
  });

  it("changes the daily budget", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    const up = await p.updateBudget(c.campaignId, usd(300));
    expect(up.dailyBudgetMicro).toBe(usd(300));
    // A negative budget is clamped rather than accepted.
    expect((await p.updateBudget(c.campaignId, -5)).dailyBudgetMicro).toBe(0);
  });

  it("refuses to act on a campaign it does not know", async () => {
    const p = platform();
    await expect(p.pauseCampaign("nope")).rejects.toThrow(/Unknown campaign/);
    expect(await p.getCampaign("nope")).toBeNull();
  });
});

describe("delivery", () => {
  it("spends to buy impressions and returns clicks individually", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    const d = await p.deliver(c.campaignId, 1);

    expect(d.impressions).toBeGreaterThan(0);
    expect(d.spendMicro).toBeGreaterThan(0);
    // Spend never exceeds the daily cap that was asked for.
    expect(d.spendMicro).toBeLessThanOrEqual(usd(175));
    // Clicks are objects, each attributable later.
    for (const click of d.clicks) {
      expect(click.clickId).toMatch(/^click_/);
      expect(click.campaignId).toBe(c.campaignId);
      expect(click.agentId).toBe("agent_001");
      expect(click.contributionMicro).toBeGreaterThan(0);
    }
  });

  it("delivers nothing while paused", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    await p.pauseCampaign(c.campaignId);
    const d = await p.deliver(c.campaignId, 1);
    expect(d.impressions).toBe(0);
    expect(d.clicks).toHaveLength(0);
    expect(d.spendMicro).toBe(0);
  });

  it("ends itself when the lifetime budget is gone", async () => {
    const p = platform();
    // Budget smaller than one day's cap: the first tick should exhaust it.
    const c = await p.createCampaign(
      input({ budgetMicro: usd(10), dailyBudgetMicro: usd(175) }),
    );
    await p.deliver(c.campaignId, 1);
    await p.deliver(c.campaignId, 2);
    expect((await p.getCampaign(c.campaignId))?.status).toBe("ended");
  });

  it("never invents a conversion on its own", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    await p.deliver(c.campaignId, 1);
    const stats = await p.getStats(c.campaignId);
    // Clicks were delivered, but nothing converted because nobody said it did.
    expect(stats?.clicks).toBeGreaterThan(0);
    expect(stats?.conversions).toBe(0);
    expect(stats?.revenueMicro).toBe(0);
  });
});

describe("conversion attribution", () => {
  it("credits a sale to the campaign that delivered the click", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    const d = await p.deliver(c.campaignId, 1);
    expect(d.clicks.length).toBeGreaterThan(0);

    const click = d.clicks[0];
    await p.recordConversion(click.clickId, click.contributionMicro);

    const stats = await p.getStats(c.campaignId);
    expect(stats?.conversions).toBe(1);
    expect(stats?.revenueMicro).toBe(click.contributionMicro);
    expect(stats?.conversionRate).toBeGreaterThan(0);
  });

  it("rejects an unknown click, and will not count one twice", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    const d = await p.deliver(c.campaignId, 1);
    const click = d.clicks[0];

    await p.recordConversion(click.clickId, click.contributionMicro);
    // A replayed postback must not inflate revenue.
    await expect(
      p.recordConversion(click.clickId, click.contributionMicro),
    ).rejects.toThrow(/Unknown click/);
    await expect(p.recordConversion("click_nope", 1)).rejects.toThrow();
  });
});

describe("statistics", () => {
  it("reports CTR and conversion rate from the events, not from constants", async () => {
    const p = platform();
    const c = await p.createCampaign(input());
    const d = await p.deliver(c.campaignId, 1);
    const stats = await p.getStats(c.campaignId);

    expect(stats?.ctr).toBeCloseTo(d.clicks.length / d.impressions, 10);
    expect(stats?.spendMicro).toBe(d.spendMicro);
    expect(await p.getStats("nope")).toBeNull();
  });
});

describe("determinism", () => {
  it("replays identically for the same seed", async () => {
    const run = async (seed: number) => {
      const p = platform(seed);
      const c = await p.createCampaign(input());
      const d = await p.deliver(c.campaignId, 1);
      return { id: c.campaignId, impressions: d.impressions, clicks: d.clicks.length };
    };
    expect(await run(42)).toEqual(await run(42));
    // Impressions are arithmetic on spend and CPM, so they do not move with the seed —
    // clicks do, because CTR is drawn from the seeded generator. That is what to assert on.
    expect((await run(42)).clicks).not.toBe((await run(99)).clicks);
  });
});

describe("platform selection", () => {
  it("defaults to the local simulator", () => {
    process.env.AD_PLATFORM = undefined;
    expect(selectedAdPlatformName()).toBe("mock");
  });

  it("falls back to the simulator on an unknown value", () => {
    process.env.AD_PLATFORM = "typo";
    expect(selectedAdPlatformName()).toBe("mock");
    process.env.AD_PLATFORM = undefined;
  });

  it("agents depend on the interface, not the implementation", async () => {
    // Anything satisfying AdPlatform can stand in — which is what makes Adsterra droppable.
    const p: AdPlatform = platform();
    expect(p.name).toBe("mock");
    expect(typeof p.createCampaign).toBe("function");
    expect(typeof p.deliver).toBe("function");
    expect(typeof p.recordConversion).toBe("function");
    expect(typeof p.getStats).toBe("function");
  });
});
