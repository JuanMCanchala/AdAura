import { describe, expect, it } from "vitest";
import { generateCreatives, templateCreative } from "./creative";
import { randomGenome } from "./genome";
import { mulberry32 } from "./rng";

/**
 * A publication has to know where it came from. The gallery joins creative → agent →
 * campaign → tracking on these fields, so if they drift the story stops being traceable.
 */

const PRODUCT = {
  name: "Aurora Sleep Mask",
  priceUsd: 49,
  margin: 0.62,
  category: "wellness",
};

const rng = mulberry32(11);
const AGENTS = [
  { id: "agent_001", label: "A01", genome: { ...randomGenome(rng), tone: "urgent" as const } },
  { id: "agent_002", label: "A02", genome: { ...randomGenome(rng), tone: "educational" as const } },
];

describe("a creative knows its provenance", () => {
  it("carries the tick and the campaign it was published under", () => {
    const c = templateCreative(
      AGENTS[0].genome,
      PRODUCT,
      "ctx",
      "img://ref",
      7,
      "mock_campaign_abc",
    );
    expect(c.tick).toBe(7);
    expect(c.adCampaignId).toBe("mock_campaign_abc");
    expect(c.imageRef).toBe("img://ref");
  });

  it("defaults to no campaign when the agent has not started one", () => {
    const c = templateCreative(AGENTS[0].genome, PRODUCT, "ctx");
    expect(c.adCampaignId).toBeNull();
    expect(c.tick).toBe(0);
  });
});

describe("generated creatives map to the right agent and campaign", () => {
  it("stamps each agent's own campaign id onto its own publication", async () => {
    // No provider configured in tests, so this exercises the template path end to end.
    const creatives = await generateCreatives({
      product: PRODUCT,
      context: "Roasted last week.",
      image: null,
      imageRef: "img://shared",
      tick: 3,
      campaignIds: {
        agent_001: "mock_campaign_aaa",
        agent_002: "mock_campaign_bbb",
      },
      agents: AGENTS,
    });

    expect(creatives.get("agent_001")?.adCampaignId).toBe("mock_campaign_aaa");
    expect(creatives.get("agent_002")?.adCampaignId).toBe("mock_campaign_bbb");
    // Every publication shares the one product photo, which is what makes the
    // side-by-side comparison in the gallery meaningful.
    expect(creatives.get("agent_001")?.imageRef).toBe("img://shared");
    expect(creatives.get("agent_002")?.imageRef).toBe("img://shared");
    for (const c of creatives.values()) expect(c.tick).toBe(3);
  });

  it("gives agents with different genomes different copy", async () => {
    const creatives = await generateCreatives({
      product: PRODUCT,
      context: "Roasted last week.",
      image: null,
      imageRef: null,
      tick: 1,
      agents: AGENTS,
    });
    const a = creatives.get("agent_001");
    const b = creatives.get("agent_002");
    expect(a?.headline).not.toBe(b?.headline);
  });

  it("produces one creative per agent, not duplicates", async () => {
    const creatives = await generateCreatives({
      product: PRODUCT,
      context: "",
      image: null,
      imageRef: null,
      tick: 1,
      agents: AGENTS,
    });
    expect(creatives.size).toBe(AGENTS.length);
    expect([...creatives.keys()].sort()).toEqual(["agent_001", "agent_002"]);
  });
});

describe("a newborn agent publishes its own ad", () => {
  it("does not inherit the parent's creative, and writes one from its own genome", async () => {
    const { createCampaign, tick } = await import("./engine");
    const { createAdPlatform } = await import("./ads/index");
    const { resetAgentCounter } = await import("./evolution");
    const { mulberry32 } = await import("./rng");

    resetAgentCounter();
    const { campaign, market } = createCampaign({
      product: PRODUCT,
      budgetUsd: 60_000,
      perAgentUsd: 2_100,
      epochCapUsd: 175,
      populationSize: 6,
      seed: 999,
      evolution: { ticksPerGeneration: 3, maxPopulation: 10, minPopulation: 3 },
    });
    const rng = mulberry32(campaign.seed ^ 0x5eed);
    const hooks = {
      adPlatform: createAdPlatform(market, campaign.seed),
      originUrl: "http://demo.test",
    };
    // Far enough for a generation boundary, so children actually exist.
    for (let i = 0; i < 9; i++) await tick(campaign, market, rng, hooks);

    const children = campaign.agents.filter((a) => a.parentId !== null);
    expect(children.length).toBeGreaterThan(0);

    for (const child of children) {
      // Every child arrives with a publication of its own.
      expect(child.creative).not.toBeNull();
      expect(child.creatives.length).toBeGreaterThan(0);
      expect(child.creative?.visual).toBeTruthy();

      const parent = campaign.agents.find((a) => a.id === child.parentId);
      // A mutated genome must yield different copy, or evolution is invisible on screen.
      if (parent?.creative && child.mutatedGenes.length > 0) {
        const changedTone = child.genome.tone !== parent.genome.tone;
        if (changedTone) {
          expect(child.creative?.headline).not.toBe(parent.creative.headline);
          expect(child.creative?.visual).not.toBe(parent.creative.visual);
        }
      }
    }
  });

  it("writes the birth creative once, not on every tick", async () => {
    const { createCampaign, tick } = await import("./engine");
    const { createAdPlatform } = await import("./ads/index");
    const { resetAgentCounter } = await import("./evolution");
    const { mulberry32 } = await import("./rng");

    resetAgentCounter();
    const { campaign, market } = createCampaign({
      product: PRODUCT,
      budgetUsd: 60_000,
      perAgentUsd: 2_100,
      epochCapUsd: 175,
      populationSize: 6,
      seed: 999,
      evolution: { ticksPerGeneration: 3, maxPopulation: 10, minPopulation: 3 },
    });
    const rng = mulberry32(campaign.seed ^ 0x5eed);
    const hooks = {
      adPlatform: createAdPlatform(market, campaign.seed),
      originUrl: "http://demo.test",
    };
    for (let i = 0; i < 12; i++) await tick(campaign, market, rng, hooks);

    // Ticks must not append publications; only a birth or an explicit pitch-off does.
    for (const child of campaign.agents.filter((a) => a.parentId !== null)) {
      expect(child.creatives.length).toBe(1);
    }
  });
});
