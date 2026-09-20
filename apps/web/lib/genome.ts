import { type Rng, hash32, pick } from "./rng";

/**
 * A genome is a complete marketing strategy expressed as a handful of discrete genes.
 * The whole space is 6 x 5 x 6 x 5 x 5 x 3 x 3 = 40,500 strategies — far too many to try
 * one by one on a real budget, which is exactly why the population searches it instead.
 */
export const GENE_POOL = {
  platform: [
    "instagram",
    "tiktok",
    "x",
    "youtube",
    "google_search",
    "newsletter",
  ],
  audience: ["teens", "young_adults", "professionals", "parents", "premium"],
  contentType: [
    "short_video",
    "carousel",
    "static_image",
    "long_form",
    "meme",
    "testimonial",
  ],
  tone: ["humorous", "educational", "aspirational", "urgent", "empathetic"],
  cta: ["direct_buy", "learn_more", "discount_code", "free_trial", "scarcity"],
  bid: ["conservative", "balanced", "aggressive"],
  frequency: ["low", "medium", "high"],
} as const;

export type GeneName = keyof typeof GENE_POOL;
export const GENE_NAMES = Object.keys(GENE_POOL) as GeneName[];

export type Genome = { [K in GeneName]: (typeof GENE_POOL)[K][number] };

export const STRATEGY_SPACE_SIZE = GENE_NAMES.reduce(
  (n, g) => n * GENE_POOL[g].length,
  1,
);

export function randomGenome(rng: Rng): Genome {
  const g = {} as Genome;
  for (const name of GENE_NAMES) {
    (g as Record<string, string>)[name] = pick(rng, GENE_POOL[name]);
  }
  return g;
}

/**
 * Mutate one to `maxGenes` genes. Small, observable steps: a child stays recognisably the
 * child of its parent, so the lineage tree tells a story instead of being noise.
 */
export function mutate(
  parent: Genome,
  rng: Rng,
  maxGenes = 2,
): { genome: Genome; changed: GeneName[] } {
  const genome = { ...parent };
  const changed: GeneName[] = [];
  const count = 1 + Math.floor(rng() * maxGenes);
  const shuffled = [...GENE_NAMES].sort(() => rng() - 0.5);

  for (const name of shuffled.slice(0, count)) {
    const alternatives = GENE_POOL[name].filter((v) => v !== parent[name]);
    if (alternatives.length === 0) continue;
    (genome as Record<string, string>)[name] = pick(rng, alternatives);
    changed.push(name);
  }
  return { genome, changed };
}

/** Canonical serialisation — what gets hashed on chain so a genome is tamper-evident. */
export function canonical(genome: Genome): string {
  return GENE_NAMES.map((n) => `${n}=${genome[n]}`).join("|");
}

/** Cheap, stable id for a strategy. The on-chain genomeHash uses keccak over `canonical`. */
export function genomeFingerprint(genome: Genome): string {
  return hash32(canonical(genome)).toString(16).padStart(8, "0");
}

export function describe(genome: Genome): string {
  return `${genome.contentType.replace(/_/g, " ")} on ${genome.platform.replace(/_/g, " ")} for ${genome.audience.replace(/_/g, " ")}, ${genome.tone} tone, ${genome.cta.replace(/_/g, " ")} CTA`;
}

export function geneDistance(a: Genome, b: Genome): number {
  return GENE_NAMES.filter((n) => a[n] !== b[n]).length;
}
