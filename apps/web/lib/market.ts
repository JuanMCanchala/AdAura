import { type Genome, GENE_NAMES } from "./genome";
import { type Rng, clamp, hashUnit, mulberry32, noise } from "./rng";

/**
 * The market the agents live in.
 *
 * It holds a *latent truth*: a real click-through and conversion rate for every strategy,
 * built out of per-platform economics plus hidden pairwise interactions between genes
 * (humour lands with teens and dies with a premium audience, scarcity works for a $400
 * product and insults a $9 one, and so on).
 *
 * No agent ever reads this. The interactions are derived from the product itself, so the
 * optimal strategy is different for every campaign and cannot be memorised — the only way
 * to find it is to spend money and measure, which is what the population does.
 */

export type ProductSpec = {
  name: string;
  priceUsd: number;
  /** Fraction of price left after cost of goods — the money a sale actually contributes. */
  margin: number;
  category: string;
  audienceHint?: string;
};

export type AdResult = {
  impressions: number;
  clicks: number;
  conversions: number;
  revenueMicro: number;
  ctr: number;
  cvr: number;
  cpmMicro: number;
};

const CPM_USD: Record<string, number> = {
  instagram: 6,
  tiktok: 4,
  x: 5,
  youtube: 8,
  google_search: 12,
  newsletter: 3,
};

const BASE_CTR: Record<string, number> = {
  instagram: 0.012,
  tiktok: 0.018,
  x: 0.008,
  youtube: 0.01,
  google_search: 0.035,
  newsletter: 0.022,
};

/** Purchase intent already present on the platform, before any strategy is applied. */
const BASE_CVR: Record<string, number> = {
  instagram: 0.02,
  tiktok: 0.015,
  x: 0.018,
  youtube: 0.025,
  google_search: 0.06,
  newsletter: 0.05,
};

/**
 * Global difficulty knob. Tuned so the best strategy in the space returns roughly +150% and
 * the worst around -90%, which is what a real paid-acquisition spread looks like. Without it
 * the toy economics hand every agent a 50x return and the evolution proves nothing.
 */
const CVR_SCALE = 0.3;

export const BID: Record<
  string,
  { spendShare: number; cpmMultiplier: number; reach: number }
> = {
  conservative: { spendShare: 0.35, cpmMultiplier: 0.85, reach: 0.9 },
  balanced: { spendShare: 0.65, cpmMultiplier: 1.0, reach: 1.0 },
  aggressive: { spendShare: 1.0, cpmMultiplier: 1.35, reach: 1.15 },
};

/** Showing the same person the same ad more often buys reach and burns goodwill. */
const FREQUENCY: Record<string, { reach: number; fatigue: number }> = {
  low: { reach: 0.8, fatigue: 1.08 },
  medium: { reach: 1.0, fatigue: 1.0 },
  high: { reach: 1.25, fatigue: 0.78 },
};

/** Willingness to pay, which scales conversion for expensive products. */
const AUDIENCE_WEALTH: Record<string, number> = {
  teens: 0.45,
  young_adults: 0.85,
  professionals: 1.25,
  parents: 1.05,
  premium: 1.6,
};

export type Market = {
  seed: number;
  product: ProductSpec;
  /** Ground truth, for the dashboard's "what was the answer?" reveal after the demo. */
  peek: () => { bestGenomeSample: Genome | null };
  serveAds: (genome: Genome, spendMicro: number, rng: Rng) => AdResult;
  trueRoi: (genome: Genome) => number;
};

const MICRO = 1_000_000;

/**
 * Hidden pairwise interaction between two genes, in roughly [0.55, 1.6].
 * Derived from the product name, so each campaign has its own landscape.
 */
function interaction(seedKey: string, a: string, b: string): number {
  const u = hashUnit(`${seedKey}::${a}::${b}`);
  return 0.6 + u * u * 0.8;
}

/** How well the creative format suits the platform, and the message the audience. */
function strategyMultipliers(product: ProductSpec, g: Genome) {
  const key = `${product.name}::${product.category}`;

  const format = interaction(`${key}::format`, g.platform, g.contentType);
  const message = interaction(`${key}::message`, g.tone, g.audience);
  const offer = interaction(`${key}::offer`, g.cta, g.audience);
  const fit = interaction(`${key}::fit`, g.audience, product.category);

  // Price sensitivity is not hidden — it is real economics, and it punishes strategies that
  // aim an expensive product at an audience that cannot buy it.
  const wealth = AUDIENCE_WEALTH[g.audience] ?? 1;
  const priceBand = clamp(product.priceUsd / 60, 0.25, 4);
  const affordability = clamp(wealth / priceBand, 0.2, 1.35);

  return {
    ctrMultiplier: format * message * FREQUENCY[g.frequency].fatigue,
    cvrMultiplier: offer * fit * affordability,
  };
}

export function createMarket(product: ProductSpec, seed = 1337): Market {
  const contributionMicro = Math.round(
    product.priceUsd * product.margin * MICRO,
  );

  function rates(genome: Genome) {
    const m = strategyMultipliers(product, genome);
    const ctr = clamp(
      BASE_CTR[genome.platform] * m.ctrMultiplier,
      0.0005,
      0.12,
    );
    const cvr = clamp(BASE_CVR[genome.platform] * m.cvrMultiplier, 0.001, 0.22);
    return { ctr, cvr };
  }

  function serveAds(genome: Genome, spendMicro: number, rng: Rng): AdResult {
    const bid = BID[genome.bid];
    const freq = FREQUENCY[genome.frequency];
    const cpmMicro = Math.round(
      CPM_USD[genome.platform] * bid.cpmMultiplier * MICRO,
    );

    if (spendMicro <= 0 || cpmMicro <= 0) {
      return {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenueMicro: 0,
        ctr: 0,
        cvr: 0,
        cpmMicro,
      };
    }

    const reach = bid.reach * freq.reach;
    const impressions = Math.floor(
      ((spendMicro / cpmMicro) * 1000 * reach) / 1,
    );

    const truth = rates(genome);
    const ctr = clamp(truth.ctr * noise(rng, 0.22), 0, 0.3);
    const clicks = Math.floor(impressions * ctr);

    const cvr = clamp(truth.cvr * noise(rng, 0.3), 0, 0.5);
    const conversions = Math.floor(
      clicks * cvr + (rng() < (clicks * cvr) % 1 ? 1 : 0),
    );

    return {
      impressions,
      clicks,
      conversions,
      revenueMicro: conversions * contributionMicro,
      ctr,
      cvr,
      cpmMicro,
    };
  }

  /** Noise-free ROI of a strategy. Only the dashboard's post-mortem view may call this. */
  function trueRoi(genome: Genome): number {
    const spendMicro = 10 * MICRO;
    const bid = BID[genome.bid];
    const cpmMicro = CPM_USD[genome.platform] * bid.cpmMultiplier * MICRO;
    const impressions =
      (spendMicro / cpmMicro) *
      1000 *
      bid.reach *
      FREQUENCY[genome.frequency].reach;
    const { ctr, cvr } = rates(genome);
    const revenue = impressions * ctr * cvr * contributionMicro;
    return (revenue - spendMicro) / spendMicro;
  }

  return {
    seed,
    product,
    serveAds,
    trueRoi,
    peek: () => ({ bestGenomeSample: null }),
  };
}

/** Exhaustive search over the whole space. Used by tests to know what the answer was. */
export function bruteForceBest(
  market: Market,
  pool: Record<string, readonly string[]>,
) {
  let best: { genome: Genome; roi: number } | null = null;
  const names = GENE_NAMES;

  const walk = (depth: number, acc: Record<string, string>) => {
    if (depth === names.length) {
      const genome = { ...acc } as Genome;
      const roi = market.trueRoi(genome);
      if (!best || roi > best.roi) best = { genome, roi };
      return;
    }
    for (const value of pool[names[depth]]) {
      acc[names[depth]] = value;
      walk(depth + 1, acc);
    }
  };
  walk(0, {});
  return best as unknown as { genome: Genome; roi: number };
}
