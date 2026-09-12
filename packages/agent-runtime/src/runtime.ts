import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPublicClient, createWalletClient, http, isAddress, parseEventLogs, type Abi, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { TurnkeyClient } from "@turnkey/http";
import { createAccount } from "@turnkey/viem";
import { NegotiationEngine, StrategyAgent, TreasuryAgent, Eip712OfferSigner, type ProtocolEvent } from "../../../frontend/packages/agents/src/index.js";
import { OFFER_DOMAIN, OFFER_TYPES } from "../../../packages/core/src/index.js";
import { toCanonicalOfferMessage } from "../../../frontend/packages/agents/src/signing/Eip712OfferSigner.js";
import type { Offer, OfferSigner, SignedOffer } from "../../../frontend/packages/agents/src/domain/types.js";
import agreementAbi from "../../../packages/core/abis/AgreementRegistry.json" with { type: "json" };
import canonical from "../../../deployments/canonical.json" with { type: "json" };

const DAY = 86_400;
const SEPOLIA = { id: 11155111, name: "Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } } } as const;
const stateVersion = 1;

export type RuntimeConfig = {
  intentId: Hex;
  capital: bigint;
  signerBackend: "turnkey" | "local";
  treasuryKey?: Hex;
  strategyKey?: Hex;
  turnkey?: {
    organizationId: string;
    apiPublicKey: string;
    apiPrivateKey: string;
    baseUrl: string;
    treasurySigner: Address;
    strategySigner: Address;
  };
  rpcUrl: string;
  broadcast: boolean;
  stateFile: string;
};

export type RuntimeResult = {
  runId: string;
  status: string;
  intentId: Hex;
  principal: Address;
  counterparty: Address;
  agreementId?: Hex;
  terms?: { duration: number; yieldBps: number; expiresAt: number; nonce: string };
  treasurySignature?: Hex;
  strategySignature?: Hex;
  transactions?: { open?: Hex; negotiate?: Hex; finalize?: Hex };
  rounds: number;
  completedAt: string;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function key(name: string): Hex {
  const value = env(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte hex private key`);
  return value as Hex;
}

function address(name: string): Address {
  const value = env(name);
  if (!isAddress(value) || value === "0x0000000000000000000000000000000000000000") throw new Error(`${name} must be a non-zero EVM address`);
  return value as Address;
}

function usdc(value: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error("AGENT_CAPITAL_USDC must be a positive USDC decimal");
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (amount <= 0n) throw new Error("AGENT_CAPITAL_USDC must be positive");
  return amount;
}

export function readConfig(intentOverride?: Hex): RuntimeConfig {
  const intentId = intentOverride || env("AGENT_INTENT_ID");
  if (!/^0x[0-9a-fA-F]{64}$/.test(intentId)) throw new Error("AGENT_INTENT_ID must be bytes32");
  const rpcUrl = env("SEPOLIA_RPC_URL");
  if (!rpcUrl.startsWith("https://") && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(rpcUrl)) throw new Error("SEPOLIA_RPC_URL must use HTTPS");
  const signerBackend = process.env.AGENT_SIGNER_BACKEND || "turnkey";
  if (signerBackend !== "turnkey" && signerBackend !== "local") throw new Error("AGENT_SIGNER_BACKEND must be turnkey or local");
  const config: RuntimeConfig = {
    intentId: intentId as Hex,
    capital: usdc(process.env.AGENT_CAPITAL_USDC || "100000"),
    signerBackend,
    rpcUrl,
    broadcast: process.env.AGENT_BROADCAST === "true",
    stateFile: resolve(process.env.AGENT_STATE_FILE || "./state/agent-runtime.json"),
  };
  if (signerBackend === "local") {
    config.treasuryKey = key("AGENT_TREASURY_PRIVATE_KEY");
    config.strategyKey = key("AGENT_STRATEGY_PRIVATE_KEY");
  } else {
    config.turnkey = {
      organizationId: env("TURNKEY_ORGANIZATION_ID"),
      apiPublicKey: env("TURNKEY_API_PUBLIC_KEY"),
      apiPrivateKey: env("TURNKEY_API_PRIVATE_KEY"),
      baseUrl: process.env.TURNKEY_BASE_URL || "https://api.turnkey.com",
      treasurySigner: address("TURNKEY_TREASURY_SIGNER"),
      strategySigner: address("TURNKEY_STRATEGY_SIGNER"),
    };
  }
  return config;
}

class TurnkeyOfferSigner implements OfferSigner {
  readonly address: Address;
  readonly domain: typeof OFFER_DOMAIN & { verifyingContract: Address };
  readonly #account: LocalAccount;

  constructor(account: LocalAccount, verifyingContract: Address) {
    this.#account = account;
    this.address = account.address;
    this.domain = { ...OFFER_DOMAIN, verifyingContract };
  }

  async signOffer(offer: Offer): Promise<SignedOffer> {
    const message = toCanonicalOfferMessage(offer);
    const publicOffer: Offer = {
      runId: offer.runId, round: offer.round, proposerRole: offer.proposerRole,
      intentId: message.intentId, proposer: message.proposer, capital: message.capital,
      duration: Number(message.duration), yieldBps: Number(message.yieldBps),
      expiresAt: Number(message.expiresAt), nonce: message.nonce,
    };
    const signature = await this.#account.signTypedData({
      domain: this.domain, types: OFFER_TYPES, primaryType: "Offer", message,
    });
    return { ...publicOffer, signature, signerAddress: this.address };
  }
}

async function createSignerAccounts(config: RuntimeConfig): Promise<{ treasury: LocalAccount; strategy: LocalAccount }> {
  if (config.signerBackend === "local") {
    if (!config.treasuryKey || !config.strategyKey) throw new Error("Local signer keys are not configured");
    return { treasury: privateKeyToAccount(config.treasuryKey), strategy: privateKeyToAccount(config.strategyKey) };
  }
  if (!config.turnkey) throw new Error("Turnkey signer configuration is missing");
  const stamper = new ApiKeyStamper({ apiPublicKey: config.turnkey.apiPublicKey, apiPrivateKey: config.turnkey.apiPrivateKey, runtimeOverride: "node" });
  const client = new TurnkeyClient({ baseUrl: config.turnkey.baseUrl }, stamper);
  const [treasury, strategy] = await Promise.all([
    createAccount({ client, organizationId: config.turnkey.organizationId, signWith: config.turnkey.treasurySigner, ethereumAddress: config.turnkey.treasurySigner }),
    createAccount({ client, organizationId: config.turnkey.organizationId, signWith: config.turnkey.strategySigner, ethereumAddress: config.turnkey.strategySigner }),
  ]);
  if (treasury.address.toLowerCase() !== config.turnkey.treasurySigner.toLowerCase() || strategy.address.toLowerCase() !== config.turnkey.strategySigner.toLowerCase()) {
    throw new Error("Turnkey signer address does not match configured agent identity");
  }
  if (treasury.address.toLowerCase() === strategy.address.toLowerCase()) throw new Error("Agent signers must derive different addresses");
  return { treasury, strategy };
}

function persist(path: string, value: RuntimeResult): void {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify({ version: stateVersion, ...value }, null, 2), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  // The rename is atomic on the same filesystem and prevents partial results.
  renameSync(temporary, target);
}

function existingResult(path: string, intentId: Hex): RuntimeResult | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as RuntimeResult & { version?: number };
    return value.version === stateVersion && value.intentId?.toLowerCase() === intentId.toLowerCase() ? value : undefined;
  } catch {
    throw new Error("Agent state file is invalid; move it aside and perform an explicit recovery review");
  }
}

export async function runOnce(config: RuntimeConfig): Promise<RuntimeResult> {
  const previous = existingResult(config.stateFile, config.intentId);
  if (previous) return previous;
  const { treasury, strategy } = await createSignerAccounts(config);
  if (treasury.address.toLowerCase() === strategy.address.toLowerCase()) throw new Error("Agent keys must derive different addresses");
  const runId = `agent-${config.intentId.slice(2, 10)}-${Date.now()}`;
  const domain = { verifyingContract: canonical.sepolia.agreementRegistry as Address };
  const binding = { intentId: config.intentId, principal: treasury.address, counterparty: strategy.address };
  const treasuryAgent = new TreasuryAgent({
    binding, identity: { name: "Treasury Agent", address: treasury.address, role: "PROPOSER" }, capital: config.capital,
    privatePolicy: { minYieldBps: 800, maxLossBps: 300, maxDuration: 30 * DAY, salt: env("AGENT_TREASURY_POLICY_SALT") },
    targetTerms: { duration: 30 * DAY, yieldBps: 900 }, concessionSchedule: [{ round: 3, duration: 27 * DAY, yieldBps: 850 }], signer: config.signerBackend === "local" ? new Eip712OfferSigner(config.treasuryKey!, domain) : new TurnkeyOfferSigner(treasury, domain.verifyingContract),
  });
  const strategyAgent = new StrategyAgent({
    binding, identity: { name: "Strategy Agent", address: strategy.address, role: "COUNTERPARTY" }, capital: config.capital,
    privatePolicy: { maxYieldBps: 900, minDuration: 20 * DAY, maxLossBps: 300, salt: env("AGENT_STRATEGY_POLICY_SALT") },
    targetTerms: { duration: 60 * DAY, yieldBps: 700 }, concessionSchedule: [{ round: 2, duration: 28 * DAY, yieldBps: 880 }], signer: config.signerBackend === "local" ? new Eip712OfferSigner(config.strategyKey!, domain) : new TurnkeyOfferSigner(strategy, domain.verifyingContract),
  });
  const engine = new NegotiationEngine({ runId, treasuryAgent, strategyAgent, maxRounds: 6 });
  let rounds = 0;
  engine.subscribe((event: ProtocolEvent) => { if (event.type.includes("OFFER") || event.type === "OFFER_ACCEPTED") rounds += 1; });
  const result = await engine.startNegotiation();
  if (result.status !== "CONVERGED" || !result.finalTerms) throw new Error("Agents did not converge");
  const output: RuntimeResult = {
    runId, status: result.status, intentId: config.intentId, principal: treasury.address, counterparty: strategy.address,
    terms: { duration: result.finalTerms.duration, yieldBps: result.finalTerms.yieldBps, expiresAt: result.finalTerms.expiresAt, nonce: result.finalTerms.nonce.toString() },
    treasurySignature: result.finalTerms.treasurySignature, strategySignature: result.finalTerms.strategySignature, rounds, completedAt: new Date().toISOString(),
  };
  if (config.broadcast) {
    const publicClient = createPublicClient({ chain: SEPOLIA, transport: http(config.rpcUrl) });
    const walletClient = createWalletClient({ account: treasury, chain: SEPOLIA, transport: http(config.rpcUrl) });
    const open = await walletClient.writeContract({ address: canonical.sepolia.agreementRegistry as Address, abi: agreementAbi as any, functionName: "openAgreement", args: [config.intentId] });
    const openReceipt = await publicClient.waitForTransactionReceipt({ hash: open });
    const events = parseEventLogs({ abi: agreementAbi as Abi, logs: openReceipt.logs, eventName: "AgreementOpened", strict: true }) as unknown as Array<{ args: { agreementId: Hex } }>;
    if (events.length !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(events[0].args.agreementId)) throw new Error("AgreementOpened event was not found");
    const agreementId = events[0].args.agreementId;
    const negotiate = await walletClient.writeContract({ address: canonical.sepolia.agreementRegistry as Address, abi: agreementAbi as any, functionName: "beginNegotiation", args: [agreementId, strategy.address] });
    await publicClient.waitForTransactionReceipt({ hash: negotiate });
    const terms = { intentId: config.intentId, principal: treasury.address, counterparty: strategy.address, capital: config.capital, duration: BigInt(result.finalTerms.duration), yieldBps: BigInt(result.finalTerms.yieldBps), expiresAt: BigInt(result.finalTerms.expiresAt), nonce: result.finalTerms.nonce };
    const finalize = await walletClient.writeContract({ address: canonical.sepolia.agreementRegistry as Address, abi: agreementAbi as any, functionName: "finalizeAgreement", args: [agreementId, terms, result.finalTerms.strategySignature] });
    await publicClient.waitForTransactionReceipt({ hash: finalize });
    output.agreementId = agreementId; output.transactions = { open, negotiate, finalize };
  }
  persist(config.stateFile, output);
  return output;
}

export async function runScheduled(config: RuntimeConfig): Promise<void> {
  const seconds = Number(process.env.AGENT_SCHEDULE_SECONDS || "0");
  if (!Number.isSafeInteger(seconds) || seconds < 0 || (seconds > 0 && seconds < 30)) throw new Error("AGENT_SCHEDULE_SECONDS must be 0 or at least 30");
  const execute = async () => { try { console.log(JSON.stringify(await runOnce(config))); } catch (error) { console.error(JSON.stringify({ error: "Agent run failed" })); } };
  await execute();
  if (seconds === 0) return;
  setInterval(() => void execute(), seconds * 1000);
  await new Promise<void>(() => undefined);
}
