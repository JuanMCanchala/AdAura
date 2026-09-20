import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ChainBridge, type ChainConfig, configFromEnv } from "./chain";
import { type CampaignInput, createCampaign } from "./engine";
import { resetAgentCounter } from "./evolution";
import { type Market, createMarket } from "./market";
import { type Rng, mulberry32 } from "./rng";
import type { Campaign } from "./types";

/**
 * One campaign at a time, held in the server process.
 *
 * The economics of record live on chain — this is a cache of the strategies, creatives and
 * market history that would be pointless to store in a contract. A JSON snapshot on disk
 * means a dev-server restart mid-demo does not lose the population.
 */

type Session = {
  campaign: Campaign;
  market: Market;
  rng: Rng;
  bridge: ChainBridge | null;
  /** Agent id -> HD derivation index, so a restart recovers the same wallets. */
  walletIndex: Map<string, number>;
  nextWalletIndex: number;
};

const SNAPSHOT = resolve(process.cwd(), "data/campaign.json");

declare global {
  var __darwinSession: Session | null | undefined;
}

export function getSession(): Session | null {
  if (globalThis.__darwinSession === undefined) {
    globalThis.__darwinSession = restore();
  }
  return globalThis.__darwinSession ?? null;
}

export function requireSession(): Session {
  const s = getSession();
  if (!s) throw new Error("No campaign yet. Create one at / first.");
  return s;
}

export async function startCampaign(input: CampaignInput): Promise<Session> {
  // Agent numbering restarts with each campaign, so the labels a judge reads on the
  // dashboard are A01…A12 and not whatever the previous run happened to leave behind.
  resetAgentCounter();
  const { campaign, market } = createCampaign(input);

  const cfg = configFromEnv();
  const session: Session = {
    campaign,
    market,
    rng: mulberry32(campaign.seed ^ 0x5eed),
    bridge: cfg ? new ChainBridge(cfg) : null,
    walletIndex: new Map(),
    nextWalletIndex: 0,
  };

  for (const agent of campaign.agents) {
    session.walletIndex.set(agent.id, session.nextWalletIndex++);
  }

  globalThis.__darwinSession = session;
  persist();
  return session;
}

export function endCampaign(): void {
  globalThis.__darwinSession = null;
  try {
    writeFileSync(SNAPSHOT, "null", "utf8");
  } catch {
    // A read-only filesystem (Vercel) just means no snapshot; the session still works.
  }
}

/** Assign a wallet slot to an agent born after the campaign started. */
export function walletIndexFor(session: Session, agentId: string): number {
  const existing = session.walletIndex.get(agentId);
  if (existing !== undefined) return existing;

  const index = session.nextWalletIndex++;
  session.walletIndex.set(agentId, index);
  return index;
}

export function chainConfig(): ChainConfig | null {
  return configFromEnv();
}

export function persist(): void {
  const session = globalThis.__darwinSession;
  if (!session) return;
  try {
    mkdirSync(dirname(SNAPSHOT), { recursive: true });
    writeFileSync(
      SNAPSHOT,
      JSON.stringify(
        {
          campaign: session.campaign,
          walletIndex: [...session.walletIndex.entries()],
          nextWalletIndex: session.nextWalletIndex,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Serverless filesystems are read-only. Losing the snapshot is survivable.
  }
}

function restore(): Session | null {
  try {
    const raw = readFileSync(SNAPSHOT, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.campaign) return null;

    const campaign = parsed.campaign as Campaign;
    const cfg = configFromEnv();

    return {
      campaign,
      market: createMarket(campaign.product, campaign.seed),
      // The generator's internal state is not serialisable; a restart re-seeds it. The
      // campaign's money and lineage are unaffected, only the next noise draw differs.
      rng: mulberry32((campaign.seed ^ 0x5eed) + campaign.tick),
      bridge: cfg ? new ChainBridge(cfg) : null,
      walletIndex: new Map(parsed.walletIndex ?? []),
      nextWalletIndex: parsed.nextWalletIndex ?? campaign.agents.length,
    };
  } catch {
    return null;
  }
}

export type { Session };
