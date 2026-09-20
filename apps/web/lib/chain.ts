import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEther,
  toHex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { agentTreasuryAbi, mockUSDAbi } from "./abi";
import { type Genome, canonical } from "./genome";
import type { Micro } from "./types";

/**
 * Everything that touches Ethereum.
 *
 * Each agent gets a real wallet derived from one campaign mnemonic, and each agent signs its
 * own spend() calls. That is the part that matters: the treasury does not take the backend's
 * word for who is spending, it reads msg.sender.
 */

export const hashkeyTestnet = defineChain({
  id: 133,
  name: "HashKey Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hsk.xyz"] } },
  blockExplorers: {
    default: {
      name: "HashKey Explorer",
      url: "https://testnet-explorer.hskchain.net",
    },
  },
  testnet: true,
});

export const SUPPORTED_CHAINS: Record<number, Chain> = {
  [hashkeyTestnet.id]: hashkeyTestnet,
  [sepolia.id]: sepolia,
};

export type ChainConfig = {
  chain: Chain;
  rpcUrl: string;
  treasury: Address;
  token: Address;
  mnemonic: string;
  /** Native gas dripped to each fresh agent wallet so it can sign its own transactions. */
  gasDripEther: string;
};

export function configFromEnv(): ChainConfig | null {
  const treasury = process.env.TREASURY_ADDRESS as Address | undefined;
  const token = process.env.TOKEN_ADDRESS as Address | undefined;
  const mnemonic = process.env.DEPLOYER_MNEMONIC;
  if (!treasury || !token || !mnemonic) return null;

  const chainId = Number(process.env.CHAIN_ID ?? hashkeyTestnet.id);
  const chain = SUPPORTED_CHAINS[chainId] ?? hashkeyTestnet;

  return {
    chain,
    rpcUrl: process.env.RPC_URL ?? chain.rpcUrls.default.http[0],
    treasury,
    token,
    mnemonic,
    gasDripEther: process.env.GAS_DRIP_ETHER ?? "0.002",
  };
}

export function explorerTx(cfg: ChainConfig, hash: string): string {
  const base = cfg.chain.blockExplorers?.default.url ?? "";
  return `${base}/tx/${hash}`;
}

export function explorerAddress(cfg: ChainConfig, address: string): string {
  const base = cfg.chain.blockExplorers?.default.url ?? "";
  return `${base}/address/${address}`;
}

/** keccak of the canonical strategy string — what ties an on-chain agent to its genome. */
export function genomeHash(genome: Genome): Hex {
  return keccak256(toHex(canonical(genome)));
}

export class ChainBridge {
  readonly cfg: ChainConfig;
  readonly publicClient: PublicClient;
  /** Index 0 of the mnemonic: funds the campaign, registers agents, settles revenue. */
  readonly operator: Account;
  private readonly operatorWallet: WalletClient;
  private readonly agentWallets = new Map<number, WalletClient>();

  constructor(cfg: ChainConfig) {
    this.cfg = cfg;
    const transport = http(cfg.rpcUrl);

    this.publicClient = createPublicClient({
      chain: cfg.chain,
      transport,
    }) as PublicClient;
    this.operator = mnemonicToAccount(cfg.mnemonic);
    this.operatorWallet = createWalletClient({
      account: this.operator,
      chain: cfg.chain,
      transport,
    });
  }

  /**
   * Agent N owns derivation path index N+1. Deterministic, so a restarted backend recovers
   * exactly the same wallets instead of orphaning funded addresses.
   */
  agentAccount(index: number): Account {
    return mnemonicToAccount(this.cfg.mnemonic, { addressIndex: index + 1 });
  }

  agentWallet(index: number): WalletClient {
    const existing = this.agentWallets.get(index);
    if (existing) return existing;

    const wallet = createWalletClient({
      account: this.agentAccount(index),
      chain: this.cfg.chain,
      transport: http(this.cfg.rpcUrl),
    });
    this.agentWallets.set(index, wallet);
    return wallet;
  }

  // ------------------------------------------------------------ campaign

  async openCampaign(args: {
    fundingMicro: Micro;
    globalCapMicro: Micro;
    epochSeconds: number;
  }): Promise<{ campaignId: bigint; hashes: string[] }> {
    const hashes: string[] = [];

    const approve = await this.operatorWallet.writeContract({
      address: this.cfg.token,
      abi: mockUSDAbi,
      functionName: "approve",
      args: [this.cfg.treasury, BigInt(args.fundingMicro) * 2n],
      chain: this.cfg.chain,
      account: this.operator,
    });
    hashes.push(approve);
    await this.publicClient.waitForTransactionReceipt({ hash: approve });

    const open = await this.operatorWallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "openCampaign",
      args: [
        this.cfg.token,
        BigInt(args.fundingMicro),
        BigInt(args.globalCapMicro),
        BigInt(args.epochSeconds),
        this.operator.address,
      ],
      chain: this.cfg.chain,
      account: this.operator,
    });
    hashes.push(open);
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: open,
    });

    const campaignId = await this.publicClient.readContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "nextCampaignId",
    });

    void receipt;
    return { campaignId: (campaignId as bigint) - 1n, hashes };
  }

  // -------------------------------------------------------------- agents

  /** A wallet with no native balance cannot sign anything, so every agent gets a drip. */
  async fundGas(index: number): Promise<string | null> {
    const account = this.agentAccount(index);
    const balance = await this.publicClient.getBalance({
      address: account.address,
    });
    const target = parseEther(this.cfg.gasDripEther);
    if (balance >= target / 2n) return null;

    return this.operatorWallet.sendTransaction({
      to: account.address,
      value: target,
      chain: this.cfg.chain,
      account: this.operator,
    });
  }

  async registerAgent(args: {
    campaignId: bigint;
    index: number;
    allowanceMicro: Micro;
    epochCapMicro: Micro;
    genome: Genome;
  }): Promise<{ address: Address; hash: string }> {
    const account = this.agentAccount(args.index);
    await this.fundGas(args.index);

    const hash = await this.operatorWallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "registerAgent",
      args: [
        args.campaignId,
        account.address,
        BigInt(args.allowanceMicro),
        BigInt(args.epochCapMicro),
        genomeHash(args.genome),
      ],
      chain: this.cfg.chain,
      account: this.operator,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { address: account.address, hash };
  }

  async reproduce(args: {
    parentIndex: number;
    childIndex: number;
    allowanceMicro: Micro;
    epochCapMicro: Micro;
    genome: Genome;
  }): Promise<{ address: Address; hash: string }> {
    const child = this.agentAccount(args.childIndex);
    await this.fundGas(args.childIndex);

    const hash = await this.operatorWallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "reproduce",
      args: [
        this.agentAccount(args.parentIndex).address,
        child.address,
        BigInt(args.allowanceMicro),
        BigInt(args.epochCapMicro),
        genomeHash(args.genome),
      ],
      chain: this.cfg.chain,
      account: this.operator,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { address: child.address, hash };
  }

  async kill(index: number): Promise<string> {
    const hash = await this.operatorWallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "kill",
      args: [this.agentAccount(index).address],
      chain: this.cfg.chain,
      account: this.operator,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ------------------------------------------------------------- economy

  /**
   * The agent signs this itself. If it asks for more than any of its four ceilings allow,
   * the node rejects the transaction and the backend never gets a hash — which is exactly
   * the guarantee we want to show a judge.
   */
  async spend(
    index: number,
    payee: Address,
    amountMicro: Micro,
    memo: string,
  ): Promise<string> {
    const wallet = this.agentWallet(index);
    const hash = await wallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "spend",
      args: [payee, BigInt(amountMicro), memoHash(memo)],
      chain: this.cfg.chain,
      account: this.agentAccount(index),
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async recordRevenue(
    index: number,
    amountMicro: Micro,
    conversionId: string,
  ): Promise<string> {
    const approve = await this.operatorWallet.writeContract({
      address: this.cfg.token,
      abi: mockUSDAbi,
      functionName: "approve",
      args: [this.cfg.treasury, BigInt(amountMicro)],
      chain: this.cfg.chain,
      account: this.operator,
    });
    await this.publicClient.waitForTransactionReceipt({ hash: approve });

    const hash = await this.operatorWallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "recordRevenue",
      args: [
        this.agentAccount(index).address,
        BigInt(amountMicro),
        memoHash(conversionId),
      ],
      chain: this.cfg.chain,
      account: this.operator,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ------------------------------------------------------ human controls

  async setPaused(campaignId: bigint, paused: boolean): Promise<string> {
    const hash = await this.operatorWallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "setPaused",
      args: [campaignId, paused],
      chain: this.cfg.chain,
      account: this.operator,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async setGlobalCap(campaignId: bigint, capMicro: Micro): Promise<string> {
    const hash = await this.operatorWallet.writeContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "setGlobalCap",
      args: [campaignId, BigInt(capMicro)],
      chain: this.cfg.chain,
      account: this.operator,
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  // ---------------------------------------------------------------- read

  async spendableNow(index: number): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "spendableNow",
      args: [this.agentAccount(index).address],
    }) as Promise<bigint>;
  }

  async onChainAgent(index: number) {
    return this.publicClient.readContract({
      address: this.cfg.treasury,
      abi: agentTreasuryAbi,
      functionName: "agents",
      args: [this.agentAccount(index).address],
    });
  }
}

/** Memos live in a bytes32, so long strings are hashed rather than truncated. */
export function memoHash(memo: string): Hex {
  const bytes = new TextEncoder().encode(memo);
  return bytes.length <= 31
    ? (toHex(memo, { size: 32 }) as Hex)
    : keccak256(toHex(memo));
}

export { privateKeyToAccount };
