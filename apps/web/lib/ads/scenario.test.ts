import { afterEach, describe, expect, it } from "vitest";
import { createAdPlatform } from "./index";
import { SCENARIOS, activeScenario, resolveSeed } from "./scenario";
import { createCampaign, tick } from "../engine";
import { resetAgentCounter } from "../evolution";
import { mulberry32 } from "../rng";

/**
 * The pitch depends on this: the run rehearsed is the run the audience sees.
 */

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("scenario selection", () => {
  it("prefers an explicit seed over anything configured", () => {
    process.env.DEMO_SCENARIO = "competition";
    expect(resolveSeed(7)).toBe(7);
  });

  it("resolves a named scenario to its seed", () => {
    process.env.DEMO_SCENARIO = "competition";
    expect(resolveSeed()).toBe(SCENARIOS.competition.seed);
    expect(activeScenario()?.name).toBe("competition");
  });

  it("falls back to SIMULATION_SEED, then to nothing", () => {
    process.env.DEMO_SCENARIO = undefined;
    process.env.SIMULATION_SEED = "123";
    expect(resolveSeed()).toBe(123);

    process.env.SIMULATION_SEED = undefined;
    expect(resolveSeed()).toBeUndefined();
    expect(activeScenario()).toBeNull();
  });

  it("ignores an unknown scenario name rather than erroring", () => {
    process.env.DEMO_SCENARIO = "not-a-scenario";
    process.env.SIMULATION_SEED = undefined;
    expect(resolveSeed()).toBeUndefined();
    expect(activeScenario()).toBeNull();
  });
});

/** A full run, so determinism is proven end to end rather than one call at a time. */
async function runScenario(seed: number, ticks = 12) {
  resetAgentCounter();
  const { campaign, market } = createCampaign({
    product: {
      name: "Cafe Especial de Narino",
      priceUsd: 49,
      margin: 0.62,
      category: "food",
    },
    budgetUsd: 60_000,
    perAgentUsd: 2_100,
    epochCapUsd: 175,
    populationSize: 6,
    seed,
    evolution: { ticksPerGeneration: 3, maxPopulation: 10, minPopulation: 3 },
  });
  const rng = mulberry32(campaign.seed ^ 0x5eed);
  const hooks = {
    adPlatform: createAdPlatform(market, campaign.seed),
    originUrl: "http://demo.test",
  };
  for (let i = 0; i < ticks; i++) await tick(campaign, market, rng, hooks);
  return campaign;
}

function fingerprint(campaign: Awaited<ReturnType<typeof runScenario>>) {
  return campaign.agents
    .map(
      (a) =>
        `${a.label}:${a.status}:${a.spentMicro}:${a.revenueMicro}:${a.adCampaignStatus}:${a.budgetScale}`,
    )
    .join("|");
}

describe("deterministic demo", () => {
  it("replays identically for the same seed", async () => {
    const a = await runScenario(SCENARIOS.competition.seed);
    const b = await runScenario(SCENARIOS.competition.seed);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("produces a different run for a different seed", async () => {
    const a = await runScenario(SCENARIOS.competition.seed);
    const c = await runScenario(SCENARIOS.attrition.seed);
    expect(fingerprint(a)).not.toBe(fingerprint(c));
  });

  it("the competition scenario shows both halves of the argument", async () => {
    const campaign = await runScenario(SCENARIOS.competition.seed, 15);

    const winners = campaign.agents.filter(
      (a) => a.revenueMicro > a.spentMicro,
    );
    const scaledUp = campaign.agents.filter((a) => a.budgetScale > 1);
    const pausedThemselves = campaign.agents.filter(
      (a) => a.adCampaignStatus === "paused",
    );

    // A demo needs visible winners that lean in, and visible losers that back off.
    expect(winners.length).toBeGreaterThanOrEqual(2);
    expect(scaledUp.length).toBeGreaterThanOrEqual(2);
    expect(pausedThemselves.length).toBeGreaterThanOrEqual(2);

    // Every campaign id came from the platform, not from the agent inventing one.
    for (const a of campaign.agents) {
      if (a.adCampaignId) expect(a.adCampaignId).toMatch(/^mock_campaign_/);
    }

    // And the population actually reproduced, so the lineage strip has something to show.
    expect(Math.max(...campaign.agents.map((a) => a.generation))).toBeGreaterThan(0);
  });
});
