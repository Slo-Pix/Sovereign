"use client";

import { useMemo, useState } from "react";
import { useCreateWallet, useLinkAccount, usePrivy, useWallets } from "@privy-io/react-auth";
import { Bot, Check, Clipboard, ExternalLink, Play, Plus, ShieldCheck } from "lucide-react";
import { createWalletClient, custom, type Address, type Hex } from "viem";
import {
  NegotiationEngine,
  StrategyAgent,
  TreasuryAgent,
  toCanonicalOfferMessage,
  type OfferSigner,
  type ProtocolEvent,
  type SignedOffer,
} from "../../packages/agents/src/index";
import { OFFER_TYPES } from "../../../packages/core/src/index";
import canonical from "../../../deployments/canonical.json";

const STORAGE_KEY = "sovereign.public-workspace.v1";
const STORAGE_EVENT = "sovereign-public-workspace-change";
const SEPOLIA_ID = 11155111;
const DAY = 86_400;

type RunState = "idle" | "running" | "complete" | "failed";
type PublicRound = { actor: string; action: string; round: number; terms?: string };

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function publicOffer(offer: SignedOffer): string {
  return `${(offer.yieldBps / 100).toFixed(2)}% APR / ${Math.round(offer.duration / DAY)} days`;
}

function savedIntentId(): string {
  if (typeof window === "undefined") return "";
  try {
    const workspace = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as { intentId?: unknown };
    return typeof workspace.intentId === "string" ? workspace.intentId : "";
  } catch {
    return "";
  }
}

function walletSigner(wallet: { address: string; switchChain(id: number): Promise<void>; getEthereumProvider(): Promise<EthereumProvider> }): OfferSigner {
  const address = wallet.address as Address;
  const domain = { name: "Sovereign", version: "1", chainId: SEPOLIA_ID, verifyingContract: canonical.sepolia.agreementRegistry as Address } as const;
  return {
    address,
    domain,
    async signOffer(offer) {
      await wallet.switchChain(SEPOLIA_ID);
      const provider = await wallet.getEthereumProvider();
      const client = createWalletClient({ account: address, chain: { id: SEPOLIA_ID, name: "Sepolia", nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } } }, transport: custom(provider) });
      const message = toCanonicalOfferMessage(offer);
      const signature = await client.signTypedData({ account: address, domain, types: OFFER_TYPES, primaryType: "Offer", message });
      return { ...offer, signature, signerAddress: address };
    },
  };
}

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export default function AutonomousAgentRun() {
  const { authenticated } = usePrivy();
  const { wallets, ready } = useWallets();
  const [intentId, setIntentId] = useState<string>(savedIntentId);
  const [capital, setCapital] = useState("100000");
  const [state, setState] = useState<RunState>("idle");
  const [rounds, setRounds] = useState<PublicRound[]>([]);
  const [result, setResult] = useState<{ duration: number; yieldBps: number; signature: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingAgentWallet, setCreatingAgentWallet] = useState(false);
  const { linkWallet } = useLinkAccount({
    onError: () => setError("The additional wallet was not linked. Select a different account and approve the Privy linking request."),
  });
  const { createWallet } = useCreateWallet({
    onSuccess: ({ wallet }) => setStrategyAddress(wallet.address),
    onError: () => setError("The Privy agent wallet could not be created. Check the Privy dashboard's embedded-wallet settings."),
  });

  const walletOptions = useMemo(() => wallets.filter((wallet, index, list) => list.findIndex((item) => item.address.toLowerCase() === wallet.address.toLowerCase()) === index), [wallets]);
  const [treasuryAddress, setTreasuryAddress] = useState("");
  const [strategyAddress, setStrategyAddress] = useState("");

  function selected(address: string) {
    return walletOptions.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase());
  }

  async function createAgentWallet() {
    setError(null);
    setCreatingAgentWallet(true);
    try {
      await createWallet();
    } catch {
      // Privy's callback provides the sanitized user-facing error above.
    } finally {
      setCreatingAgentWallet(false);
    }
  }

  function useSavedIntent() {
    const saved = savedIntentId();
    if (!saved) {
      setError("No saved Intent ID was found. Create an intent first from the Create Agreement page.");
      return;
    }
    setIntentId(saved);
    setError(null);
  }

  async function run() {
    setState("running"); setError(null); setResult(null); setRounds([]);
    try {
      const treasuryWallet = selected(treasuryAddress);
      const strategyWallet = selected(strategyAddress);
      if (!treasuryWallet || !strategyWallet) throw new Error("Select two different connected wallets for the Treasury and Strategy agents.");
      if (treasuryWallet.address.toLowerCase() === strategyWallet.address.toLowerCase()) throw new Error("Treasury and Strategy agents must use different wallets.");
      if (!/^0x[0-9a-fA-F]{64}$/.test(intentId)) throw new Error("Intent ID must be a bytes32 value.");
      if (!/^\d+(\.\d{1,6})?$/.test(capital) || Number(capital) <= 0) throw new Error("Capital must be a positive USDC amount.");

      const treasurySigner = walletSigner(treasuryWallet);
      const strategySigner = walletSigner(strategyWallet);
      const binding = { intentId: intentId as Hex, principal: treasuryWallet.address as Address, counterparty: strategyWallet.address as Address };
      const treasury = new TreasuryAgent({
        binding, identity: { name: "Treasury Agent", address: treasuryWallet.address as Address, role: "PROPOSER" },
        capital: BigInt(Math.round(Number(capital) * 1_000_000)), privatePolicy: { minYieldBps: 800, maxLossBps: 300, maxDuration: 30 * DAY, salt: "agent-policy-hidden" },
        targetTerms: { duration: 30 * DAY, yieldBps: 900 }, concessionSchedule: [{ round: 3, duration: 27 * DAY, yieldBps: 850 }], signer: treasurySigner,
      });
      const strategy = new StrategyAgent({
        binding, identity: { name: "Strategy Agent", address: strategyWallet.address as Address, role: "COUNTERPARTY" },
        capital: treasury.capital, privatePolicy: { maxYieldBps: 900, minDuration: 20 * DAY, maxLossBps: 300, salt: "strategy-policy-hidden" },
        targetTerms: { duration: 60 * DAY, yieldBps: 700 }, concessionSchedule: [{ round: 2, duration: 28 * DAY, yieldBps: 880 }], signer: strategySigner,
      });
      const engine = new NegotiationEngine({ runId: `agent-run-${Date.now()}`, treasuryAgent: treasury, strategyAgent: strategy, maxRounds: 6 });
      engine.subscribe((event: ProtocolEvent) => {
        const offer = (event.payload as { offer?: SignedOffer }).offer;
        if (offer) setRounds((current) => [...current, { actor: event.type.includes("COUNTER") ? "STRATEGY" : offer.proposerRole, action: event.type.replace("NEGOTIATION_", "").replace("OFFER_", ""), round: offer.round, terms: publicOffer(offer) }]);
      });
      const runResult = await engine.startNegotiation();
      if (runResult.status !== "CONVERGED" || !runResult.finalTerms) throw new Error("The agents did not converge on compatible terms.");
      const finalTerms = runResult.finalTerms;
      setResult({ duration: finalTerms.duration, yieldBps: finalTerms.yieldBps, signature: finalTerms.strategySignature });
      setState("complete");
    } catch (cause) {
      setState("failed");
      setError(cause instanceof Error ? cause.message : "Autonomous negotiation failed.");
    }
  }

  function loadIntoWorkspace() {
    if (!result) return;
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, intentId, principal: treasuryAddress, counterparty: strategyAddress, capital, durationDays: String(Math.round(result.duration / DAY)), yieldPercent: (result.yieldBps / 100).toFixed(2), signature: result.signature, expiresAt: String(Math.floor(Date.now() / 1000) + 86_400), nonce: "1" }));
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }

  return (
    <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-on-surface bg-surface-container-high p-5">
        <div className="flex items-start gap-3"><Bot size={22} aria-hidden="true" /><div><div className="font-label-caps text-label-caps text-primary font-bold">AUTONOMOUS AGENT RUN</div><h2 className="font-headline-md text-headline-md font-bold">Treasury ↔ Strategy</h2><p className="font-body-sm text-body-sm text-secondary mt-1">Agents negotiate bounded public terms and sign the converged offer. Private policy rationale stays inside the agent runtime.</p></div></div>
        <span className="border border-on-surface px-2 py-1 font-label-caps text-label-caps font-bold">{state === "running" ? "RUNNING" : state === "complete" ? "CONVERGED" : "READY"}</span>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-4">
        <label><span className="flex items-center justify-between gap-2 font-label-caps text-label-caps text-secondary font-bold"><span>INTENT ID</span><button type="button" onClick={useSavedIntent} disabled={state === "running"} className="inline-flex items-center gap-1 border border-on-surface px-1.5 py-0.5 font-label-caps text-label-caps font-bold" title="Load the Intent ID saved by Create Agreement"><Clipboard size={12} />Use saved</button></span><input className="mt-1 w-full border-2 border-on-surface p-2 font-code-sm" value={intentId} onChange={(e) => setIntentId(e.target.value)} disabled={state === "running"} placeholder="0x... bytes32" /></label>
        <label><span className="font-label-caps text-label-caps text-secondary font-bold">CAPITAL / USDC</span><input className="mt-1 w-full border-2 border-on-surface p-2 font-code-sm" value={capital} onChange={(e) => setCapital(e.target.value)} disabled={state === "running"} /></label>
        <label><span className="font-label-caps text-label-caps text-secondary font-bold">TREASURY WALLET</span><select className="mt-1 w-full border-2 border-on-surface bg-white p-2 font-code-sm" value={treasuryAddress} onChange={(e) => setTreasuryAddress(e.target.value)} disabled={state === "running"}><option value="">Select wallet</option>{walletOptions.map((wallet) => <option key={wallet.address} value={wallet.address}>{short(wallet.address)}</option>)}</select></label>
        <label><span className="font-label-caps text-label-caps text-secondary font-bold">STRATEGY WALLET</span><select className="mt-1 w-full border-2 border-on-surface bg-white p-2 font-code-sm" value={strategyAddress} onChange={(e) => setStrategyAddress(e.target.value)} disabled={state === "running"}><option value="">Select wallet</option>{walletOptions.map((wallet) => <option key={wallet.address} value={wallet.address}>{short(wallet.address)}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-on-surface p-5">
        {walletOptions.length < 2 && <button type="button" onClick={createAgentWallet} disabled={!ready || !authenticated || state === "running" || creatingAgentWallet} className="inline-flex min-h-11 items-center gap-2 border-2 border-on-surface bg-surface-container-lowest px-4 py-2 font-code-sm font-bold disabled:opacity-40"><Plus size={16} />{creatingAgentWallet ? "Creating agent wallet" : "Create strategy wallet"}</button>}
        {walletOptions.length < 2 && <button type="button" onClick={() => { setError(null); linkWallet({ description: "Link a second wallet for the Strategy agent. This preserves your current Treasury wallet." }); }} disabled={!ready || !authenticated || state === "running" || creatingAgentWallet} className="inline-flex min-h-11 items-center gap-2 border-2 border-on-surface bg-surface-container-lowest px-4 py-2 font-code-sm font-bold disabled:opacity-40"><Plus size={16} />Link second wallet</button>}
        <button type="button" onClick={run} disabled={!ready || state === "running" || walletOptions.length < 2} className="inline-flex min-h-11 items-center gap-2 border-2 border-on-surface bg-on-surface px-4 py-2 font-code-sm font-bold text-white disabled:opacity-40"><Play size={16} />Run autonomous negotiation</button>
        {state === "complete" && <button type="button" onClick={loadIntoWorkspace} className="inline-flex min-h-11 items-center gap-2 border-2 border-on-surface bg-primary-container px-4 py-2 font-code-sm font-bold"><ExternalLink size={16} />Load converged terms</button>}
        {walletOptions.length < 2 && <span className="font-code-sm text-secondary">{authenticated ? "Link a second wallet to preserve both independent agent identities." : "Sign in through Privy before adding a second wallet."}</span>}
      </div>
      {error && <div className="mx-5 mb-5 border-2 border-red-700 bg-red-50 p-3 font-code-sm text-red-800">{error}</div>}
      {rounds.length > 0 && <div className="border-t border-on-surface"><div className="flex items-center gap-2 border-b border-on-surface p-4 font-label-caps text-label-caps font-bold"><ShieldCheck size={16} />PUBLIC ROUND EVIDENCE</div>{rounds.map((round) => <div key={`${round.round}-${round.actor}`} className="grid grid-cols-[60px_1fr_auto] gap-3 border-b border-surface-container-high p-3 font-code-sm"><span>R{round.round}</span><span><strong>{round.actor}</strong> / {round.action}</span><span className="text-primary">{round.terms}</span></div>)}</div>}
      {state === "complete" && result && <div className="flex items-center gap-2 border-t-2 border-on-surface bg-[#E6F4EA] p-4 font-code-sm"><Check size={17} />Terms converged at {(result.yieldBps / 100).toFixed(2)}% APR for {Math.round(result.duration / DAY)} days. The Strategy signature is ready for the agreement workspace.</div>}
    </section>
  );
}
