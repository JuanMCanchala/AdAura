import { describe, expect, it } from "vitest";
import { createCampaign, plannedSpend, tick, totalSpent } from "./engine";
import {
  GENE_POOL,
  canonical,
  geneDistance,
  mutate,
  randomGenome,
} from "./genome";
import { bruteForceBest } from "./market";
import { mulberry32 } from "./rng";
import {
  fitnessOf,
  populationStats,
  profitOf,
  remainingAllowance,
} from "./evolution";
import { MICRO, PROFIT_ONLY, usd } from "./types";

const PRODUCT = {
  name: "Aurora Sleep Mask",
  priceUsd: 49,
  margin: 0.62,
  category: "wellness",
};

function freshCampaign(seed: number, overrides = {}) {
  return createCampaign({
    product: PRODUCT,
    budgetUsd: 4000,
    perAgentUsd: 60,
    epochCapUsd: 10,
    populationSize: 10,
    seed,
    evolution: { ticksPerGeneration: 3, maxPopulation: 12, minPopulation: 6 },
    ...overrides,
  });
}

async function run(seed: number, generations: number) {
  const { campaign, market } = freshCampaign(seed);
  const rng = mulberry32(seed ^ 0x5eed);
  const roiByGeneration: number[] = [];

  for (let g = 0; g < generations; g++) {
    for (let t = 0; t < 3; t++) await tick(campaign, market, rng);
    const alive = campaign.agents.filter((a) => a.status === "alive");
    if (alive.length === 0) break;
    const rates = alive.map((a) =>
      a.spentMicro === 0 ? 0 : profitOf(a) / a.spentMicro,
    );
    roiByGeneration.push(rates.reduce((s, r) => s + r, 0) / rates.length);
  }
  return { campaign, market, roiByGeneration };
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);

describe("the population actually learns", () => {
  // The claim the whole project rests on. If this ever goes red, the demo is a lie.
  it.each([1, 7, 42, 99, 2026])(
    "improves mean ROI over 18 generations (seed %i)",
    async (seed) => {
      const { roiByGeneration } = await run(seed, 18);
      expect(roiByGeneration.length).toBeGreaterThan(10);

      const early = mean(roiByGeneration.slice(0, 3));
      const late = mean(roiByGeneration.slice(-3));
      expect(late).toBeGreaterThan(early);
    },
  );

  it("closes a real part of the gap to the brute-forced global optimum", async () => {
    const { campaign, market } = await run(99, 18);
    const truth = bruteForceBest(
      market,
      GENE_POOL as unknown as Record<string, readonly string[]>,
    );

    const gen0 = campaign.agents.filter((a) => a.generation === 0);
    const gen0Best = Math.max(...gen0.map((a) => market.trueRoi(a.genome)));
    const found = Math.max(
      ...campaign.agents.map((a) => market.trueRoi(a.genome)),
    );

    expect(found).toBeGreaterThan(gen0Best);
    expect(found).toBeLessThanOrEqual(truth.roi + 1e-9);
    // Half of the remaining headroom is a low bar for 18 generations, and it still proves
    // the search is directed rather than a random walk.
    expect(found).toBeGreaterThan(gen0Best + (truth.roi - gen0Best) * 0.3);
  });

  it("never goes extinct", async () => {
    const { campaign } = await run(99, 18);
    expect(
      campaign.agents.filter((a) => a.status === "alive").length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("the human's money is bounded", () => {
  it("never spends more than the campaign cap, however the population evolves", async () => {
    for (const seed of [3, 11, 77]) {
      const { campaign, market } = freshCampaign(seed);
      const rng = mulberry32(seed);
      for (let t = 0; t < 60; t++) await tick(campaign, market, rng);
      expect(totalSpent(campaign)).toBeLessThanOrEqual(campaign.globalCapMicro);
    }
  });

  it("stops every agent while paused", async () => {
    const { campaign, market } = freshCampaign(5);
    const rng = mulberry32(5);
    await tick(campaign, market, rng);
    const spentBefore = totalSpent(campaign);

    campaign.paused = true;
    for (let t = 0; t < 5; t++) await tick(campaign, market, rng);
    expect(totalSpent(campaign)).toBe(spentBefore);
  });

  it("keeps an agent's planned spend inside every ceiling", async () => {
    const { campaign, market } = freshCampaign(8);
    const rng = mulberry32(8);
    for (let t = 0; t < 12; t++) {
      for (const a of campaign.agents.filter((x) => x.status === "alive")) {
        const planned = plannedSpend(a, campaign);
        expect(planned).toBeLessThanOrEqual(a.epochCapMicro);
        expect(planned).toBeLessThanOrEqual(remainingAllowance(a));
      }
      await tick(campaign, market, rng);
    }
  });

  it("lets a profitable agent reinvest what it earned, and no more", () => {
    const { campaign } = freshCampaign(1);
    const a = campaign.agents[0];
    a.allowanceMicro = usd(20);
    a.spentMicro = usd(20);
    expect(remainingAllowance(a)).toBe(0);

    a.revenueMicro = usd(15);
    expect(remainingAllowance(a)).toBe(usd(15));
  });
});

describe("lineage", () => {
  it("mutates between one and two genes, so a child stays recognisable", () => {
    const rng = mulberry32(12);
    for (let i = 0; i < 200; i++) {
      const parent = randomGenome(rng);
      const { genome, changed } = mutate(parent, rng, 2);
      const distance = geneDistance(parent, genome);
      expect(distance).toBe(changed.length);
      expect(distance).toBeGreaterThanOrEqual(1);
      expect(distance).toBeLessThanOrEqual(2);
    }
  });

  it("gives every child a parent that exists", async () => {
    const { campaign } = await run(42, 12);
    const ids = new Set(campaign.agents.map((a) => a.id));
    for (const a of campaign.agents) {
      if (a.parentId !== null) expect(ids.has(a.parentId)).toBe(true);
    }
  });

  it("produces a canonical form that ignores key order, so the on-chain hash is stable", () => {
    const rng = mulberry32(3);
    const genome = randomGenome(rng);
    const reordered = Object.fromEntries(
      Object.entries(genome).sort(([a], [b]) => b.localeCompare(a)),
    ) as typeof genome;

    expect(canonical(reordered)).toBe(canonical(genome));
    expect(canonical(genome)).toContain(`platform=${genome.platform}`);
  });
});

describe("fitness", () => {
  it("is profit by default", () => {
    const { campaign } = freshCampaign(1);
    const a = campaign.agents[0];
    a.spentMicro = usd(8);
    a.revenueMicro = usd(35);
    expect(fitnessOf(a, PROFIT_ONLY)).toBe(usd(27));
  });

  it("can be reweighted to prefer cheap conversions", () => {
    const { campaign } = freshCampaign(1);
    const [cheap, rich] = campaign.agents;

    cheap.spentMicro = usd(10);
    cheap.revenueMicro = usd(20);
    cheap.clicks = 100;
    cheap.conversions = 20;

    rich.spentMicro = usd(10);
    rich.revenueMicro = usd(22);
    rich.clicks = 100;
    rich.conversions = 2;

    const weights = { profit: 1, conversionRate: 5, costPerAcquisition: 0.5 };
    expect(fitnessOf(cheap, weights)).toBeGreaterThan(fitnessOf(rich, weights));
    expect(fitnessOf(rich, PROFIT_ONLY)).toBeGreaterThan(
      fitnessOf(cheap, PROFIT_ONLY),
    );
  });
});

describe("accounting", () => {
  it("reports population totals that add up", async () => {
    const { campaign } = await run(42, 9);
    const stats = populationStats(campaign);

    expect(stats.total).toBe(campaign.agents.length);
    expect(stats.alive + stats.dead).toBe(stats.total);
    expect(stats.profitMicro).toBe(stats.revenueMicro - stats.spentMicro);
    expect(Number.isInteger(stats.spentMicro)).toBe(true);
    expect(stats.spentMicro % 1).toBe(0);
  });

  it("keeps every amount an integer number of micro-dollars", async () => {
    const { campaign } = await run(7, 6);
    for (const a of campaign.agents) {
      expect(Number.isInteger(a.spentMicro)).toBe(true);
      expect(Number.isInteger(a.revenueMicro)).toBe(true);
      for (const tx of a.txs)
        expect(Number.isInteger(tx.amountMicro)).toBe(true);
    }
    expect(MICRO).toBe(1_000_000);
  });
});
