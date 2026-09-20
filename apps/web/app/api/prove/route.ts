import { NextResponse } from "next/server";
import type { Address } from "viem";
import { explorerAddress, explorerTx, genomeHash } from "@/lib/chain";
import { log } from "@/lib/engine";
import { remainingAllowance } from "@/lib/evolution";
import {
  chainConfig,
  persist,
  requireSession,
  walletIndexFor,
} from "@/lib/store";
import { toUsd } from "@/lib/types";
import {
  decodePayment,
  encodePayment,
  networkName,
  verifyPayment,
} from "@/lib/x402";

export const dynamic = "force-dynamic";
// Vercel's Hobby plan caps a function at 60s; asking for more fails the deploy. Six round
// trips to a testnet fit well inside that, and locally there is no limit either way.
export const maxDuration = 60;

/**
 * Take one agent all the way through the real thing, on a real chain:
 *
 *   1. register the agent and its budget in AgentTreasury
 *   2. ask the ad exchange for inventory   -> 402 Payment Required
 *   3. the agent signs spend() itself      -> money leaves its wallet under its own budget
 *   4. retry with the X-PAYMENT proof      -> 200, inventory served
 *   5. settle a conversion through the oracle
 *   6. try to overspend                    -> the chain rejects it
 *
 * Step 6 is the one worth watching. The agent asks for more than its ceiling and the node
 * refuses the transaction; no amount of prompting gets it past a require().
 */
export async function POST(request: Request) {
  const cfg = chainConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "No chain configured. Deploy the contracts and fill TREASURY_ADDRESS / TOKEN_ADDRESS in .env.",
      },
      { status: 503 },
    );
  }

  let session: ReturnType<typeof requireSession>;
  try {
    session = requireSession();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }

  const bridge = session.bridge;
  if (!bridge)
    return NextResponse.json({ error: "No chain bridge." }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const { campaign } = session;
  const agent =
    campaign.agents.find((a) => a.id === body.agentId) ??
    campaign.agents.find((a) => a.status === "alive");
  if (!agent)
    return NextResponse.json(
      { error: "No living agent to prove with." },
      { status: 409 },
    );

  const steps: Array<{
    step: string;
    detail: string;
    txUrl?: string;
    ok: boolean;
  }> = [];
  const index = walletIndexFor(session, agent.id);
  const payTo = (process.env.AD_NETWORK_ADDRESS ??
    "0x000000000000000000000000000000000000dEaD") as Address;

  try {
    // 1 — the campaign exists on chain
    if (!campaign.chain.campaignId) {
      const opened = await bridge.openCampaign({
        fundingMicro: campaign.budgetMicro,
        globalCapMicro: campaign.globalCapMicro,
        epochSeconds: 60,
      });
      campaign.chain = {
        chainId: cfg.chain.id,
        treasury: cfg.treasury,
        token: cfg.token,
        campaignId: opened.campaignId.toString(),
        explorer: cfg.chain.blockExplorers?.default.url ?? null,
        live: true,
      };
      steps.push({
        step: "Campaign funded on chain",
        detail: `$${toUsd(campaign.budgetMicro).toFixed(2)} deposited, cap $${toUsd(campaign.globalCapMicro).toFixed(2)}`,
        txUrl: explorerTx(cfg, opened.hashes[opened.hashes.length - 1]),
        ok: true,
      });
    }
    const campaignId = BigInt(campaign.chain.campaignId ?? "1");

    // 2 — the agent gets a wallet and a budget the contract knows about
    if (!agent.address) {
      const registered = await bridge.registerAgent({
        campaignId,
        index,
        allowanceMicro: remainingAllowance(agent),
        epochCapMicro: agent.epochCapMicro,
        genome: agent.genome,
      });
      agent.address = registered.address;
      agent.txs.push({
        kind: "register",
        hash: registered.hash,
        amountMicro: remainingAllowance(agent),
        memo: genomeHash(agent.genome),
        tick: campaign.tick,
      });
      steps.push({
        step: `${agent.label} registered with its own wallet`,
        detail: registered.address,
        txUrl: explorerAddress(cfg, registered.address),
        ok: true,
      });
    }

    const spendable = await bridge.spendableNow(index);
    const priceMicro =
      Number(spendable) > 0
        ? Math.min(Number(spendable), agent.epochCapMicro)
        : 0;
    if (priceMicro <= 0) {
      steps.push({
        step: "Agent is out of budget",
        detail: "Nothing left to spend on chain.",
        ok: false,
      });
      persist();
      return NextResponse.json({ agentId: agent.id, steps });
    }

    // 3 — ask the exchange, get refused
    const origin = new URL(request.url).origin;
    const quoteResponse = await fetch(`${origin}/api/services/ads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, priceMicro }),
    });
    const quote = await quoteResponse.json();
    steps.push({
      step: "Ad exchange answered 402 Payment Required",
      detail: `${quote?.accepts?.[0]?.description ?? "inventory"} — $${toUsd(priceMicro).toFixed(2)} in mUSD`,
      ok: quoteResponse.status === 402,
    });

    // 4 — the agent pays, signing with its own key
    const spendTx = await bridge.spend(
      index,
      payTo,
      priceMicro,
      `x402:${agent.trackingId}`,
    );
    agent.spentMicro += priceMicro;
    agent.txs.push({
      kind: "spend",
      hash: spendTx,
      amountMicro: priceMicro,
      memo: "x402 settlement",
      tick: campaign.tick,
    });
    steps.push({
      step: `${agent.label} paid from its own wallet`,
      detail: `$${toUsd(priceMicro).toFixed(2)} settled through AgentTreasury.spend()`,
      txUrl: explorerTx(cfg, spendTx),
      ok: true,
    });

    // 5 — retry with proof, get the goods
    const paid = await fetch(`${origin}/api/services/ads`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payment": encodePayment({
          x402Version: 1,
          scheme: "exact",
          network: networkName(cfg.chain.id),
          payload: {
            txHash: spendTx as `0x${string}`,
            from: agent.address as Address,
            amount: String(priceMicro),
            memo: `x402:${agent.trackingId}`,
          },
        }),
      },
      body: JSON.stringify({ agentId: agent.id, priceMicro }),
    });
    const served = await paid.json();
    steps.push({
      step: "Payment verified against the chain, inventory served",
      detail: paid.ok
        ? `${served.inventory.impressions.toLocaleString()} impressions on ${served.inventory.platform}`
        : (served.error ?? "rejected"),
      ok: paid.ok,
    });

    if (paid.ok) {
      agent.impressions += served.inventory.impressions;
    }

    // 6 — the part that cannot be talked around
    const overspend =
      Number(await bridge.spendableNow(index)) +
      agent.epochCapMicro +
      1_000_000;
    try {
      await bridge.spend(index, payTo, overspend, "overspend attempt");
      steps.push({
        step: "Overspend attempt",
        detail: "It went through. That is a bug.",
        ok: false,
      });
    } catch (e) {
      steps.push({
        step: `${agent.label} tried to spend $${toUsd(overspend).toFixed(2)} and the chain refused`,
        detail: revertReason(e),
        ok: true,
      });
    }

    log(
      campaign,
      "chain",
      agent.id,
      `${agent.label} completed an on-chain x402 settlement`,
    );
    persist();

    return NextResponse.json({
      agentId: agent.id,
      address: agent.address,
      steps,
    });
  } catch (e) {
    steps.push({ step: "Stopped", detail: failureReason(e), ok: false });
    persist();
    return NextResponse.json({ agentId: agent.id, steps }, { status: 500 });
  }
}

/**
 * One readable line for the panel.
 *
 * viem's errors carry the whole request — ABI, args, docs link — which is what you want in a
 * log and not what you want on a projector. A revert still reports its custom error, because
 * that is the sentence the demo is trying to land.
 */
function failureReason(e: unknown): string {
  const message = (e as Error)?.message ?? String(e);
  const reverted = revertReason(e);
  if (reverted !== message.split("\n")[0]) return reverted;

  if (/fetch failed|ECONNREFUSED|ETIMEDOUT|socket hang up|HTTP request failed/i.test(message)) {
    return "The RPC node did not answer. Check RPC_URL and that the network is up.";
  }
  if (/insufficient funds/i.test(message)) {
    return "The operator wallet is out of native gas on this network.";
  }
  return message.split("\n")[0];
}

/** Pull the custom error name out of a viem revert, which is what a judge wants to read. */
function revertReason(e: unknown): string {
  const message = (e as Error)?.message ?? String(e);
  const match = message.match(
    /(AllowanceExceeded|EpochCapExceeded|GlobalCapExceeded|CampaignPaused|AgentDead|InsufficientTreasury)/,
  );
  return match ? `reverted with ${match[1]}` : message.split("\n")[0];
}
