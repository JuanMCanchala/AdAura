/**
 * Headless run of the whole evolutionary loop, with no chain and no UI.
 *
 * This is the honesty check for the project: if the population does not actually find
 * better strategies than it started with, the rest is theatre. It prints mean profit per
 * generation and compares the champion the population found against the true optimum,
 * which we can compute here only because we also wrote the market.
 *
 *   npm run sim -- --generations 25 --seed 42
 */
import { createCampaign, tick } from "../lib/engine";
import { bruteForceBest } from "../lib/market";
import { GENE_POOL, canonical, describe, geneDistance } from "../lib/genome";
import { fitnessOf, populationStats, profitOf } from "../lib/evolution";
import { mulberry32 } from "../lib/rng";
import { toUsd } from "../lib/types";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

async function main() {
  const generations = arg("generations", 25);
  const seed = arg("seed", 42);
  const ticksPerGeneration = 3;

  const { campaign, market } = createCampaign({
    product: {
      name: "Aurora Sleep Mask",
      priceUsd: 49,
      margin: 0.62,
      category: "wellness",
    },
    budgetUsd: 4000,
    perAgentUsd: 60,
    epochCapUsd: 10,
    populationSize: 10,
    seed,
    evolution: { ticksPerGeneration, maxPopulation: 12, minPopulation: 6 },
  });

  const rng = mulberry32(seed ^ 0x5eed);
  const history: Array<{
    gen: number;
    meanProfit: number;
    best: number;
    alive: number;
  }> = [];

  const gen0 = campaign.agents.map((a) => a.genome);

  for (let g = 0; g < generations; g++) {
    for (let t = 0; t < ticksPerGeneration; t++) {
      await tick(campaign, market, rng);
    }
    const alive = campaign.agents.filter((a) => a.status === "alive");
    if (alive.length === 0) break;

    // Per-generation profit rate, so later agents are not flattered by having lived longer.
    const rates = alive.map((a) =>
      a.spentMicro === 0 ? 0 : profitOf(a) / a.spentMicro,
    );
    history.push({
      gen: campaign.generation,
      meanProfit: rates.reduce((s, r) => s + r, 0) / rates.length,
      best: Math.max(...rates),
      alive: alive.length,
    });
  }

  const truth = bruteForceBest(
    market,
    GENE_POOL as unknown as Record<string, readonly string[]>,
  );
  const stats = populationStats(campaign);
  const champion = [...campaign.agents].sort(
    (a, b) => market.trueRoi(b.genome) - market.trueRoi(a.genome),
  )[0];

  console.log(
    `\nProduct: ${campaign.product.name} @ $${campaign.product.priceUsd}`,
  );
  console.log(
    `Seed ${seed} · ${campaign.agents.length} agents created · ${stats.alive} alive\n`,
  );

  console.log("gen   alive   mean ROI   best ROI");
  for (const h of history) {
    console.log(
      `${String(h.gen).padStart(3)}   ${String(h.alive).padStart(5)}   ${pct(h.meanProfit)}   ${pct(h.best)}`,
    );
  }

  const early = history.slice(0, 3);
  const late = history.slice(-3);
  const earlyMean =
    early.reduce((s, h) => s + h.meanProfit, 0) / (early.length || 1);
  const lateMean =
    late.reduce((s, h) => s + h.meanProfit, 0) / (late.length || 1);

  const gen0Best = Math.max(...gen0.map((g) => market.trueRoi(g)));

  console.log(`\nMean ROI, first 3 generations : ${pct(earlyMean)}`);
  console.log(`Mean ROI, last 3 generations  : ${pct(lateMean)}`);
  console.log(
    `Improvement                   : ${pct(lateMean - earlyMean)} points\n`,
  );

  console.log(`Best strategy present at gen 0 (true ROI) : ${pct(gen0Best)}`);
  console.log(
    `Best strategy the population found        : ${pct(market.trueRoi(champion.genome))}`,
  );
  console.log(`Global optimum (brute force, 40,500)      : ${pct(truth.roi)}`);
  console.log(
    `Genes away from the optimum               : ${geneDistance(champion.genome, truth.genome)} of 7\n`,
  );
  console.log(`Champion : ${describe(champion.genome)}`);
  console.log(`Optimum  : ${describe(truth.genome)}\n`);

  console.log(
    `Campaign economics: spent $${toUsd(stats.spentMicro).toFixed(2)}, ` +
      `revenue $${toUsd(stats.revenueMicro).toFixed(2)}, ` +
      `profit $${toUsd(stats.profitMicro).toFixed(2)} over ${stats.conversions} conversions`,
  );

  const improved = lateMean > earlyMean;
  console.log(
    improved
      ? "\nPASS — the population got better at selling.\n"
      : "\nFAIL — no improvement.\n",
  );
  process.exit(improved ? 0 : 1);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1).padStart(8)}%`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
