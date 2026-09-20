import { type Address, type Hex, decodeEventLog } from "viem";
import { agentTreasuryAbi } from "./abi";
import type { ChainBridge } from "./chain";
import type { Micro } from "./types";

/**
 * x402 — paying for an HTTP resource with money instead of an API key.
 *
 * The ad exchange in this project is a real 402 endpoint: it refuses to serve inventory
 * until it has been paid, and it verifies the payment by reading the Spent event out of the
 * transaction receipt rather than trusting what the caller claims.
 *
 * That is the Machine Payment Protocol shape the event's resource guide points at: an
 * autonomous agent discovers a price, settles it on chain from its own wallet, and retries.
 */

export const X402_VERSION = 1;

export type PaymentRequirements = {
  scheme: "exact";
  network: string;
  /** Price in the asset's smallest unit. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  asset: Address;
  /** Where the payer settles: our treasury, which enforces the payer's own budget. */
  extra: {
    settlement: "AgentTreasury.spend";
    treasury: Address;
    decimals: number;
  };
};

export type PaymentRequiredBody = {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
};

export type PaymentPayload = {
  x402Version: number;
  scheme: "exact";
  network: string;
  payload: {
    /** The settlement transaction the agent already broadcast. */
    txHash: Hex;
    from: Address;
    amount: string;
    memo: string;
  };
};

export function paymentRequired(args: {
  network: string;
  priceMicro: Micro;
  resource: string;
  description: string;
  payTo: Address;
  asset: Address;
  treasury: Address;
}): PaymentRequiredBody {
  return {
    x402Version: X402_VERSION,
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "exact",
        network: args.network,
        maxAmountRequired: String(args.priceMicro),
        resource: args.resource,
        description: args.description,
        mimeType: "application/json",
        payTo: args.payTo,
        asset: args.asset,
        extra: {
          settlement: "AgentTreasury.spend",
          treasury: args.treasury,
          decimals: 6,
        },
      },
    ],
  };
}

export function encodePayment(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodePayment(header: string): PaymentPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (parsed?.x402Version !== X402_VERSION || !parsed?.payload?.txHash)
      return null;
    return parsed as PaymentPayload;
  } catch {
    return null;
  }
}

export type VerificationResult =
  | { ok: true; amountMicro: Micro; payer: Address; txHash: Hex }
  | { ok: false; reason: string };

/**
 * Verify a settlement by replaying the receipt. We check the amount, the payee and that the
 * payer is the agent that asked — never the caller's own claim about any of the three.
 */
export async function verifyPayment(args: {
  bridge: ChainBridge;
  payment: PaymentPayload;
  expectedPayer: Address;
  expectedPayee: Address;
  minimumMicro: Micro;
}): Promise<VerificationResult> {
  const { bridge, payment } = args;

  let receipt: Awaited<
    ReturnType<typeof bridge.publicClient.getTransactionReceipt>
  >;
  try {
    receipt = await bridge.publicClient.getTransactionReceipt({
      hash: payment.payload.txHash,
    });
  } catch {
    return { ok: false, reason: "settlement transaction not found" };
  }
  if (receipt.status !== "success")
    return { ok: false, reason: "settlement transaction reverted" };

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== bridge.cfg.treasury.toLowerCase())
      continue;

    let event: ReturnType<typeof decodeEventLog>;
    try {
      event = decodeEventLog({
        abi: agentTreasuryAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }
    if (event.eventName !== "Spent") continue;

    const { agent, payee, amount } = event.args as unknown as {
      agent: Address;
      payee: Address;
      amount: bigint;
    };

    if (agent.toLowerCase() !== args.expectedPayer.toLowerCase()) {
      return {
        ok: false,
        reason: "payment came from a different wallet than the requester",
      };
    }
    if (payee.toLowerCase() !== args.expectedPayee.toLowerCase()) {
      return { ok: false, reason: "payment went to a different payee" };
    }
    if (amount < BigInt(args.minimumMicro)) {
      return {
        ok: false,
        reason: `underpaid: ${amount} < ${args.minimumMicro}`,
      };
    }

    return {
      ok: true,
      amountMicro: Number(amount),
      payer: agent,
      txHash: payment.payload.txHash,
    };
  }

  return {
    ok: false,
    reason: "no Spent event from the treasury in that transaction",
  };
}

export function networkName(chainId: number): string {
  return chainId === 133
    ? "hashkey-testnet"
    : chainId === 11155111
      ? "ethereum-sepolia"
      : `eip155:${chainId}`;
}
