/**
 * Reproducible demo scenarios.
 *
 * A pitch cannot rest on a coin flip. Every random draw in this project already comes from
 * a seeded generator, so fixing the seed fixes the whole run: the same population, the same
 * market, the same winners and the same agent that gives up. What a scenario does *not* do
 * is decide the outcome — the numbers still emerge from the simulation. It only guarantees
 * that the run you rehearsed is the run the audience sees.
 */

export type Scenario = {
  name: string;
  seed: number;
  /** One line for the operator, so nobody has to remember what a seed was chosen for. */
  summary: string;
};

/**
 * `competition` is the seed to demo with. Over 15 ticks it produces a population that
 * splits cleanly: a champion above +400% that scales its budget up, two profitable
 * descendants, and four agents that lose money and pause their own campaigns. Both halves
 * of the argument are on screen at once, which is what makes the point land.
 */
export const SCENARIOS: Record<string, Scenario> = {
  competition: {
    name: "competition",
    seed: 999,
    summary:
      "A champion scales past +400%, its children inherit and stay profitable, four losers pause themselves.",
  },
  // A harder market, for showing that the system does not simply always win.
  attrition: {
    name: "attrition",
    seed: 42,
    summary:
      "A market where no strategy pays off: almost every campaign pauses and the population thins out.",
  },
};

/**
 * The seed to run with, in priority order: an explicit seed from the request, then a named
 * scenario, then the raw seed env var, then nothing (the engine picks at random).
 */
export function resolveSeed(explicit?: number): number | undefined {
  if (explicit !== undefined && Number.isFinite(explicit)) return explicit;

  const scenarioName = (process.env.DEMO_SCENARIO ?? "").trim().toLowerCase();
  const scenario = SCENARIOS[scenarioName];
  if (scenario) return scenario.seed;

  const raw = Number(process.env.SIMULATION_SEED);
  return Number.isFinite(raw) ? raw : undefined;
}

/** Which scenario is configured, if any. Surfaced so the UI can say the run is reproducible. */
export function activeScenario(): Scenario | null {
  const name = (process.env.DEMO_SCENARIO ?? "").trim().toLowerCase();
  return SCENARIOS[name] ?? null;
}
