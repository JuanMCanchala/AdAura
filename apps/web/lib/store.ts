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

/**
 * Derivation indices are handed out in one block per campaign.
 *
 * AgentTreasury keys agents by address globally, not per campaign, so a second campaign that
 * restarted numbering from 0 would re-derive the first campaign's wallets and revert with
 * AgentExists(). Each campaign therefore starts at a fresh multiple of this stride, which
 * also caps how many agents one campaign can register on chain.
 */
const WALLET_BLOCK = 256;

const WALLET_CURSOR = resolve(process.cwd(), "data/wallet-cursor.json");

/**
 * The next free derivation block, persisted next to the snapshot.
 *
 * It has to outlive an individual campaign: ending one and starting another must not hand
 * the new population the old addresses. On a read-only filesystem this falls back to a
 * time-derived block, which is still collision-free in practice for a demo.
 */
function claimWalletBlock(): number {
  let next = 0;
  try {
    next = JSON.parse(readFileSync(WALLET_CURSOR, "utf8"))?.nextBlock ?? 0;
  } catch {
    // No cursor yet — start at the first block.
  }
  if (!Number.isInteger(next) || next < 0) next = 0;

  try {
    mkdirSync(dirname(WALLET_CURSOR), { recursive: true });
    writeFileSync(WALLET_CURSOR, JSON.stringify({ nextBlock: next + 1 }), "utf8");
  } catch {
    // Vercel: cannot persist the cursor, so derive a block that will not repeat.
    return (Math.floor(Date.now() / 1000) % 4096) * WALLET_BLOCK;
  }

  return next * WALLET_BLOCK;
}

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
    nextWalletIndex: claimWalletBlock(),
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
    const restoredIndices: number[] = (parsed.walletIndex ?? []).map(
      (entry: [string, number]) => entry[1],
    );

    return {
      campaign,
      market: createMarket(campaign.product, campaign.seed),
      // The generator's internal state is not serialisable; a restart re-seeds it. The
      // campaign's money and lineage are unaffected, only the next noise draw differs.
      rng: mulberry32((campaign.seed ^ 0x5eed) + campaign.tick),
      bridge: cfg ? new ChainBridge(cfg) : null,
      walletIndex: new Map(parsed.walletIndex ?? []),
      // Fall back to the high-water mark of the restored map, never to a bare agent count:
      // that would restart numbering inside a block another campaign already used.
      nextWalletIndex:
        parsed.nextWalletIndex ??
        Math.max(0, ...restoredIndices, -1) + 1,
    };
  } catch {
    return null;
  }
}

export type { Session };
