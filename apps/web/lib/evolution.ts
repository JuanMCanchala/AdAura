import { type Genome, mutate, randomGenome } from "./genome";
import type { Rng } from "./rng";
import {
  type Agent,
  type Campaign,
  type DeathReason,
  type EvolutionConfig,
  type FitnessWeights,
  type Micro,
  MICRO,
} from "./types";

/**
 * Selection, reproduction and mutation.
 *
 * Nothing here knows what a good strategy looks like. It only knows which agents came back
 * with more money than they took, and that is the entire point: the system never has to be
 * told that humour works on TikTok, it finds out by paying to be wrong a few times.
 */

export function profitOf(a: Agent): Micro {
  return a.revenueMicro - a.spentMicro;
}

export function roiOf(a: Agent): number {
  return a.spentMicro === 0 ? 0 : profitOf(a) / a.spentMicro;
}

export function conversionRateOf(a: Agent): number {
  return a.clicks === 0 ? 0 : a.conversions / a.clicks;
}

export function costPerAcquisitionMicro(a: Agent): Micro {
  return a.conversions === 0
    ? a.spentMicro
    : Math.round(a.spentMicro / a.conversions);
}

/**
 * Fitness. The MVP runs on profit alone; the extra terms let a campaign owner say
 * "I would rather buy cheap conversions than maximise this week's margin".
 */
export function fitnessOf(a: Agent, w: FitnessWeights): number {
  const base = w.profit * profitOf(a);
  if (w.conversionRate === 0 && w.costPerAcquisition === 0) return base;

  const convTerm = w.conversionRate * conversionRateOf(a) * MICRO;
  const cpaTerm =
    a.conversions === 0 ? 0 : w.costPerAcquisition * costPerAcquisitionMicro(a);
  return base + convTerm - cpaTerm;
}

export function isAlive(a: Agent): boolean {
  return a.status === "alive";
}

export function livingAgents(c: Campaign): Agent[] {
  return c.agents.filter(isAlive);
}

/**
 * Budget this agent may still burn, ignoring the per-epoch ceiling.
 *
 * An agent may re-spend what it earned. That is not a loophole: the campaign's global cap
 * still binds the population, so the human's exposure never grows — but an agent that is
 * genuinely selling gets to compound instead of starving the moment its seed money runs out.
 * AgentTreasury.spend() applies exactly the same formula on chain.
 */
export function remainingAllowance(a: Agent): Micro {
  return Math.max(0, a.allowanceMicro + a.revenueMicro - a.spentMicro);
}

export type GenerationOutcome = {
  generation: number;
  killed: Array<{ agent: Agent; reason: DeathReason; fitness: number }>;
  born: Agent[];
  survivors: Agent[];
};

/**
 * Run one generation boundary: cull, then let the best survivors reproduce with mutation.
 * The child's budget is carved out of the parent's unspent allowance — the same rule the
 * contract enforces on chain, so the two can never disagree.
 */
export function runGeneration(campaign: Campaign, rng: Rng): GenerationOutcome {
  const cfg = campaign.evolution;
  const living = livingAgents(campaign);
  const generation = campaign.generation + 1;

  const scored = living
    .map((agent) => ({ agent, fitness: fitnessOf(agent, cfg.weights) }))
    .sort((a, b) => b.fitness - a.fitness);

  const killed: GenerationOutcome["killed"] = [];
  const survivors: Agent[] = [];

  for (const entry of scored) {
    const brokeEven = entry.fitness >= cfg.survivalThresholdMicro;
    const hasBudget = remainingAllowance(entry.agent) > 0;
    // Not enough traffic bought yet to tell a bad strategy from an unlucky one.
    const untested = entry.agent.clicks < cfg.minClicksToJudge;

    if (!hasBudget) {
      // Out of money is out of the game, whatever the evidence says — it cannot act again.
      killed.push({ ...entry, reason: "out_of_budget" });
    } else if (untested) {
      survivors.push(entry.agent);
    } else if (!brokeEven) {
      killed.push({ ...entry, reason: "unprofitable" });
    } else {
      survivors.push(entry.agent);
    }
  }

  for (const { agent, reason } of killed) {
    agent.status = "dead";
    agent.diedTick = campaign.tick;
    agent.deathReason = reason;
  }

  const born = breed(campaign, survivors, generation, rng);
  born.push(
    ...immigrate(campaign, survivors.length + born.length, generation, rng),
  );

  campaign.generation = generation;
  return { generation, killed, born, survivors };
}

function breed(
  campaign: Campaign,
  survivors: Agent[],
  generation: number,
  rng: Rng,
): Agent[] {
  const cfg = campaign.evolution;
  const room = cfg.maxPopulation - survivors.length;
  if (room <= 0) return [];

  const ranked = [...survivors].sort(
    (a, b) => fitnessOf(b, cfg.weights) - fitnessOf(a, cfg.weights),
  );
  const breederCount = Math.max(
    1,
    Math.floor(ranked.length * cfg.breedFraction),
  );
  const breeders = ranked
    .slice(0, breederCount)
    .filter((a) => fitnessOf(a, cfg.weights) > 0);

  const born: Agent[] = [];
  for (const parent of breeders) {
    for (let i = 0; i < cfg.offspringPerParent && born.length < room; i++) {
      // Half of the parent's unspent allowance, capped by what a fresh agent would get.
      const inheritable = Math.min(
        Math.floor(remainingAllowance(parent) / 2),
        campaign.perAgentMicro,
      );
      if (inheritable < campaign.epochCapMicro) continue;

      const { genome, changed } = mutate(parent.genome, rng, cfg.mutationGenes);
      parent.allowanceMicro -= inheritable;

      born.push(
        newAgent(campaign, {
          genome,
          mutatedGenes: changed,
          generation,
          parentId: parent.id,
          allowanceMicro: inheritable,
        }),
      );
    }
  }
  return born;
}

/**
 * Draft fresh random strategies when selection has thinned the population too far.
 * Their budget comes out of the campaign's unallocated capital, never out of thin air.
 */
function immigrate(
  campaign: Campaign,
  livingCount: number,
  generation: number,
  rng: Rng,
): Agent[] {
  const cfg = campaign.evolution;
  const missing = cfg.minPopulation - livingCount;
  if (missing <= 0) return [];

  // Money is in exactly one of three places: already spent, committed to an agent that is
  // still trading, or free. A shut-down agent releases whatever it did not burn.
  const spent = campaign.agents.reduce((s, a) => s + a.spentMicro, 0);
  const committed = campaign.agents
    .filter(isAlive)
    .reduce((s, a) => s + Math.max(0, a.allowanceMicro - a.spentMicro), 0);
  let unallocated = Math.max(0, campaign.budgetMicro - spent - committed);

  const drafted: Agent[] = [];
  for (let i = 0; i < missing; i++) {
    const allowance = Math.min(campaign.perAgentMicro, unallocated);
    if (allowance < campaign.epochCapMicro) break;
    unallocated -= allowance;

    drafted.push(
      newAgent(campaign, {
        genome: randomGenome(rng),
        generation,
        parentId: null,
        allowanceMicro: allowance,
      }),
    );
  }
  return drafted;
}

let counter = 0;

export function newAgent(
  campaign: Campaign,
  init: {
    genome: Genome;
    mutatedGenes?: string[];
    generation: number;
    parentId: string | null;
    allowanceMicro: Micro;
  },
): Agent {
  const n = ++counter;
  const id = `agent_${String(n).padStart(3, "0")}`;
  return {
    id,
    label: labelFor(n),
    address: null,
    generation: init.generation,
    parentId: init.parentId,
    genome: init.genome,
    mutatedGenes: init.mutatedGenes ?? [],
    allowanceMicro: init.allowanceMicro,
    epochCapMicro: campaign.epochCapMicro,
    spentMicro: 0,
    revenueMicro: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    status: "alive",
    bornTick: campaign.tick,
    diedTick: null,
    deathReason: null,
    creative: null,
    trackingId: `${campaign.id}-${id}`,
    txs: [],
  };
}

/** A17, B03… short enough to read off a dashboard row. */
function labelFor(n: number): string {
  const letter = String.fromCharCode(65 + (Math.floor((n - 1) / 99) % 26));
  return `${letter}${String(((n - 1) % 99) + 1).padStart(2, "0")}`;
}

export function resetAgentCounter(): void {
  counter = 0;
}

/** Generation 0: spread across the strategy space so the search starts wide. */
export function seedPopulation(
  campaign: Campaign,
  size: number,
  rng: Rng,
): Agent[] {
  const agents: Agent[] = [];
  for (let i = 0; i < size; i++) {
    agents.push(
      newAgent(campaign, {
        genome: randomGenome(rng),
        generation: 0,
        parentId: null,
        allowanceMicro: campaign.perAgentMicro,
      }),
    );
  }
  return agents;
}

export function populationStats(
  campaign: Campaign,
  cfg: EvolutionConfig = campaign.evolution,
) {
  const alive = livingAgents(campaign);
  const spent = campaign.agents.reduce((s, a) => s + a.spentMicro, 0);
  const revenue = campaign.agents.reduce((s, a) => s + a.revenueMicro, 0);
  const conversions = campaign.agents.reduce((s, a) => s + a.conversions, 0);

  return {
    generation: campaign.generation,
    alive: alive.length,
    dead: campaign.agents.length - alive.length,
    total: campaign.agents.length,
    spentMicro: spent,
    revenueMicro: revenue,
    profitMicro: revenue - spent,
    conversions,
    roi: spent === 0 ? 0 : (revenue - spent) / spent,
    meanFitness:
      alive.length === 0
        ? 0
        : alive.reduce((s, a) => s + fitnessOf(a, cfg.weights), 0) /
          alive.length,
    bestAgent:
      alive.length === 0
        ? null
        : [...alive].sort((a, b) => profitOf(b) - profitOf(a))[0],
  };
}
