"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  Check,
  Clipboard,
  ExternalLink,
  FileSignature,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import intentAbi from "../../../packages/core/abis/IntentRegistry.json";
import agreementAbi from "../../../packages/core/abis/AgreementRegistry.json";
import canonical from "../../../deployments/canonical.json";
import {
  ARC_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  asAddress,
  asBytes32,
  daysToSeconds,
  offerTypedData,
  parseUsdc,
  percentToBps,
  policyCommitment,
  randomSalt,
  safeWalletError,
  sameAddress,
  type AgreementTerms,
} from "@/lib/protocol-actions";

const STORAGE_KEY = "sovereign.public-workspace.v1";
const STORAGE_EVENT = "sovereign-public-workspace-change";
const sepolia = defineChain({
  id: SEPOLIA_CHAIN_ID,
  name: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] } },
  blockExplorers: { default: { name: "Etherscan", url: "https://sepolia.etherscan.io" } },
});
const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

type PublicWorkspace = {
  intentId: string;
  agreementId: string;
  principal: string;
  counterparty: string;
  capital: string;
  maxDurationDays: string;
  durationDays: string;
  yieldPercent: string;
  expiryHours: string;
  expiresAt: string;
  nonce: string;
  policyCommitment: string;
  signature: string;
  finalizeTx: string;
  approvalTx: string;
};

const initialPublicState: PublicWorkspace = {
  intentId: "",
  agreementId: "",
  principal: "",
  counterparty: "",
  capital: "100000",
  maxDurationDays: "30",
  durationDays: "21",
  yieldPercent: "8.80",
  expiryHours: "24",
  expiresAt: "",
  nonce: "1",
  policyCommitment: "",
  signature: "",
  finalizeTx: "",
  approvalTx: "",
};

function readStoredWorkspace(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

function readServerWorkspace(): string {
  return "";
}

function subscribeToWorkspace(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
  };
}

function parseStoredWorkspace(value: string): PublicWorkspace {
  if (!value) return initialPublicState;
  try {
    return { ...initialPublicState, ...JSON.parse(value) as Partial<PublicWorkspace> };
  } catch {
    return initialPublicState;
  }
}

type ActionName = "intent" | "open" | "negotiate" | "sign" | "finalize" | "approve" | "status";
type ActionState = { name: ActionName; label: string } | null;
type StatusSnapshot = {
  chains: { sepolia: { state: string; blockNumber: string }; arc: { state: string; blockNumber: string } };
  latest?: { sepolia: { state: string; blockNumber: string }; arc: { state: string; blockNumber: string } };
};

const inputClass = "w-full border-2 border-on-surface bg-surface-container-lowest px-3 py-2.5 font-code-md text-code-md outline-none focus:border-primary";
const labelClass = "block font-label-caps text-label-caps font-bold text-secondary mb-1.5";
const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 border-2 border-on-surface bg-on-surface px-4 py-2.5 font-code-sm text-code-sm font-bold text-white neo-shadow neo-press disabled:cursor-not-allowed disabled:opacity-40";

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

export default function AgreementWorkspace() {
  const { ready, wallets } = useWallets();
  const wallet = wallets[0];
  const account = wallet?.address as Address | undefined;
  const storedWorkspace = useSyncExternalStore(subscribeToWorkspace, readStoredWorkspace, readServerWorkspace);
  const deal = useMemo(() => parseStoredWorkspace(storedWorkspace), [storedWorkspace]);
  const [minYield, setMinYield] = useState("8.00");
  const [maxLoss, setMaxLoss] = useState("3.00");
  const [salt, setSalt] = useState("");
  const [active, setActive] = useState<ActionState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);

  function setDeal(next: PublicWorkspace | ((current: PublicWorkspace) => PublicWorkspace)) {
    const value = typeof next === "function" ? next(deal) : next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }

  const validationRequested = Boolean(deal.finalizeTx) || [snapshot?.chains.sepolia.state, snapshot?.latest?.sepolia.state]
    .some((state) => state === "PENDING_VALIDATION" || ["ACTIVE", "BREACHED", "UNWIND", "SETTLED", "REJECTED"].includes(state ?? ""));
  const steps = useMemo(() => [
    { label: "Intent", complete: Boolean(deal.intentId) },
    { label: "Open", complete: Boolean(deal.agreementId) },
    { label: "Counterparty", complete: Boolean(deal.agreementId && deal.counterparty) },
    { label: "Signed terms", complete: Boolean(deal.signature) },
    { label: "CRE requested", complete: validationRequested },
    { label: "Arc approved", complete: Boolean(deal.approvalTx) || snapshot?.chains.arc.state === "ACTIVE" || snapshot?.chains.arc.state === "UNWOUND" || snapshot?.chains.arc.state === "SETTLED" },
  ], [deal, snapshot, validationRequested]);

  function update<K extends keyof PublicWorkspace>(key: K, value: PublicWorkspace[K]) {
    const signedFields: Array<keyof PublicWorkspace> = ["intentId", "agreementId", "principal", "counterparty", "capital", "durationDays", "yieldPercent", "expiryHours", "nonce"];
    setDeal((current) => ({
      ...current,
      [key]: value,
      ...(signedFields.includes(key) && current[key] !== value ? { signature: "", expiresAt: "" } : {}),
    }));
  }

  function start(name: ActionName, label: string) {
    setActive({ name, label });
    setError(null);
    setNotice(null);
  }

  function finish(message: string) {
    setActive(null);
    setNotice(message);
  }

  function fail(label: string, cause: unknown) {
    setActive(null);
    setError(cause instanceof Error && !cause.message.toLowerCase().includes("rpc")
      ? cause.message
      : safeWalletError(label, cause));
  }

  function requireAccount(expected?: string, role?: string): Address {
    if (!ready || !wallet || !account) throw new Error("Connect a wallet before submitting this action.");
    if (expected && !sameAddress(account, expected)) throw new Error(`Connect the ${role ?? "required"} wallet (${shortHash(expected)}).`);
    return account;
  }

  async function clients(chain: typeof sepolia | typeof arc) {
    if (!wallet) throw new Error("Connect a wallet before submitting this action.");
    try {
      await wallet.switchChain(chain.id);
    } catch (switchError) {
      const provider = await wallet.getEthereumProvider();
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: `0x${chain.id.toString(16)}`,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: [chain.blockExplorers?.default.url],
          }],
        });
      } catch {
        throw switchError;
      }
    }
    const provider = await wallet.getEthereumProvider();
    return {
      publicClient: createPublicClient({ chain, transport: custom(provider) }),
      walletClient: createWalletClient({ account: account!, chain, transport: custom(provider) }),
    };
  }

  function terms(): AgreementTerms {
    const expiryHours = Number(deal.expiryHours);
    if (!Number.isSafeInteger(expiryHours) || expiryHours < 1 || expiryHours > 168) {
      throw new Error("Offer expiry must be between 1 and 168 hours.");
    }
    if (!/^\d+$/.test(deal.nonce)) throw new Error("Offer nonce must be a nonnegative integer.");
    const expiresAt = deal.expiresAt
      ? BigInt(deal.expiresAt)
      : BigInt(Math.floor(Date.now() / 1000) + expiryHours * 3600);
    return {
      intentId: asBytes32(deal.intentId, "Intent ID"),
      principal: asAddress(deal.principal, "Principal"),
      counterparty: asAddress(deal.counterparty, "Counterparty"),
      capital: parseUsdc(deal.capital),
      duration: daysToSeconds(deal.durationDays),
      yieldBps: percentToBps(deal.yieldPercent),
      expiresAt,
      nonce: BigInt(deal.nonce),
    };
  }

  async function createIntent() {
    start("intent", "Creating intent");
    try {
      const principal = requireAccount();
      const policySalt = salt ? asBytes32(salt, "Policy salt") : randomSalt();
      if (!salt) setSalt(policySalt);
      const maxDuration = daysToSeconds(deal.maxDurationDays);
      const commitment = policyCommitment({
        minYieldBps: percentToBps(minYield),
        maxLossBps: percentToBps(maxLoss),
        maxDuration,
        salt: policySalt,
      });
      const capital = parseUsdc(deal.capital);
      const { publicClient, walletClient } = await clients(sepolia);
      const hash = await walletClient.writeContract({
        address: canonical.sepolia.intentRegistry as Address,
        abi: intentAbi as Abi,
        functionName: "createIntent",
        args: [canonical.arcTestnet.usdc, capital, maxDuration, commitment],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const events = parseEventLogs({ abi: intentAbi as Abi, logs: receipt.logs, eventName: "IntentCreated", strict: true }) as unknown as Array<{ args: { intentId: Hex } }>;
      if (events.length !== 1) throw new Error("Intent transaction confirmed without an IntentCreated event.");
      setDeal((current) => ({ ...current, principal, policyCommitment: commitment, intentId: events[0].args.intentId }));
      finish("Intent confirmed on Sepolia. Private policy values remain only in this browser session.");
    } catch (cause) {
      fail("Create intent", cause);
    }
  }

  async function openAgreement() {
    start("open", "Opening agreement");
    try {
      requireAccount(deal.principal, "principal");
      const intentId = asBytes32(deal.intentId, "Intent ID");
      const { publicClient, walletClient } = await clients(sepolia);
      const hash = await walletClient.writeContract({ address: canonical.sepolia.agreementRegistry as Address, abi: agreementAbi as Abi, functionName: "openAgreement", args: [intentId] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const events = parseEventLogs({ abi: agreementAbi as Abi, logs: receipt.logs, eventName: "AgreementOpened", strict: true }) as unknown as Array<{ args: { agreementId: Hex } }>;
      if (events.length !== 1) throw new Error("Agreement transaction confirmed without an AgreementOpened event.");
      update("agreementId", events[0].args.agreementId);
      finish("Agreement is OPEN on Sepolia.");
    } catch (cause) {
      fail("Open agreement", cause);
    }
  }

  async function beginNegotiation() {
    start("negotiate", "Starting negotiation");
    try {
      requireAccount(deal.principal, "principal");
      const agreementId = asBytes32(deal.agreementId, "Agreement ID");
      const counterparty = asAddress(deal.counterparty, "Counterparty");
      if (sameAddress(deal.principal, counterparty)) throw new Error("Principal and counterparty must be different wallets.");
      const { publicClient, walletClient } = await clients(sepolia);
      const hash = await walletClient.writeContract({ address: canonical.sepolia.agreementRegistry as Address, abi: agreementAbi as Abi, functionName: "beginNegotiation", args: [agreementId, counterparty] });
      await publicClient.waitForTransactionReceipt({ hash });
      finish("Counterparty bound. Agreement is NEGOTIATING on Sepolia.");
    } catch (cause) {
      fail("Begin negotiation", cause);
    }
  }

  async function signTerms() {
    start("sign", "Signing terms");
    try {
      const signer = requireAccount(deal.counterparty, "counterparty");
      const proposed = terms();
      const { walletClient } = await clients(sepolia);
      const signature = await walletClient.signTypedData({ account: signer, ...offerTypedData(proposed, canonical.sepolia.agreementRegistry as Address) });
      setDeal((current) => ({ ...current, expiresAt: proposed.expiresAt.toString(), signature }));
      finish("Counterparty EIP-712 signature captured. No private policy value was signed.");
    } catch (cause) {
      fail("Sign terms", cause);
    }
  }

  async function finalizeAgreement() {
    start("finalize", "Requesting CRE validation");
    try {
      requireAccount(deal.principal, "principal");
      const agreementId = asBytes32(deal.agreementId, "Agreement ID");
      const signature = deal.signature as Hex;
      if (!/^0x[0-9a-fA-F]{128}(?:[0-9a-fA-F]{2})?$/.test(signature)) throw new Error("A valid EIP-712 signature is required.");
      const proposed = terms();
      const { publicClient, walletClient } = await clients(sepolia);
      const hash = await walletClient.writeContract({
        address: canonical.sepolia.agreementRegistry as Address,
        abi: agreementAbi as Abi,
        functionName: "finalizeAgreement",
        args: [agreementId, proposed, signature],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      update("finalizeTx", hash);
      finish("Terms finalized. ValidationRequested was emitted for the CRE workflow.");
      await refreshStatus();
    } catch (cause) {
      fail("Finalize agreement", cause);
    }
  }

  async function approveEscrow() {
    start("approve", "Approving Arc escrow");
    try {
      requireAccount(deal.principal, "principal");
      const capital = parseUsdc(deal.capital);
      const { publicClient, walletClient } = await clients(arc);
      const hash = await walletClient.writeContract({
        address: canonical.arcTestnet.usdc as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [canonical.arcTestnet.sovereignEscrow as Address, capital],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      update("approvalTx", hash);
      finish("Exact capital allowance confirmed on Arc. The relayer can lock escrow after activation.");
    } catch (cause) {
      fail("Approve escrow", cause);
    }
  }

  async function refreshStatus() {
    if (!deal.agreementId) return;
    start("status", "Refreshing state");
    try {
      const id = asBytes32(deal.agreementId, "Agreement ID");
      const response = await fetch(`/api/agreements/${id}/status`, { cache: "no-store" });
      if (!response.ok) throw new Error("Finalized public state is currently unavailable.");
      setSnapshot(await response.json() as StatusSnapshot);
      finish("Finalized Sepolia and Arc state refreshed.");
    } catch (cause) {
      fail("Refresh state", cause);
    }
  }

  async function copyPolicy() {
    try {
      if (!salt) throw new Error("Generate the policy commitment before exporting the CRE secret.");
      await navigator.clipboard.writeText(JSON.stringify({
        minYieldBps: percentToBps(minYield).toString(),
        maxLossBps: percentToBps(maxLoss).toString(),
        maxDuration: daysToSeconds(deal.maxDurationDays).toString(),
        salt,
      }));
      setNotice("Private policy JSON copied for the CRE secret vault. It was not sent to this application.");
      setError(null);
    } catch (cause) {
      fail("Copy policy", cause);
    }
  }

  function resetWorkspace() {
    setDeal(initialPublicState);
    setMinYield("8.00");
    setMaxLoss("3.00");
    setSalt("");
    setSnapshot(null);
    setError(null);
    setNotice("Public workspace cleared. Onchain records are unchanged.");
  }

  const busy = Boolean(active);

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-2 border-2 border-on-surface bg-surface-container-lowest md:grid-cols-3 xl:grid-cols-6" aria-label="Agreement progress">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-h-16 items-center gap-2 border-b border-r border-on-surface px-3 py-2 last:border-r-0 md:[&:nth-child(n+4)]:border-b-0 xl:border-b-0">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 border-on-surface font-code-sm font-bold ${step.complete ? "bg-tertiary text-white" : "bg-surface-container"}`}>
              {step.complete ? <Check size={15} strokeWidth={3} /> : index + 1}
            </span>
            <span className="font-code-sm font-bold">{step.label}</span>
          </li>
        ))}
      </ol>

      {(active || notice || error) && (
        <div aria-live="polite" className={`flex items-center gap-3 border-2 border-on-surface p-3 font-code-sm font-bold ${error ? "bg-error-container text-on-error-container" : "bg-surface-container-lowest"}`}>
          {active ? <LoaderCircle className="animate-spin" size={18} /> : error ? <KeyRound size={18} /> : <Check size={18} className="text-tertiary" />}
          <span>{active?.label ?? error ?? notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <div className="space-y-6">
          <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
            <header className="flex items-center justify-between border-b-2 border-on-surface bg-surface-container-high px-4 py-3">
              <div><p className="font-label-caps text-label-caps font-bold text-primary">01 / PRINCIPAL</p><h2 className="font-headline-sm text-headline-sm font-bold">Intent and private constraints</h2></div>
              <ShieldCheck size={22} aria-hidden="true" />
            </header>
            <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
              <label><span className={labelClass}>Capital / USDC</span><input className={inputClass} value={deal.capital} onChange={(event) => update("capital", event.target.value)} disabled={Boolean(deal.intentId)} inputMode="decimal" /></label>
              <label><span className={labelClass}>Maximum duration / days</span><input className={inputClass} value={deal.maxDurationDays} onChange={(event) => update("maxDurationDays", event.target.value)} disabled={Boolean(deal.intentId)} inputMode="numeric" /></label>
              <label><span className={labelClass}>Minimum yield / % APR</span><input className={inputClass} value={minYield} onChange={(event) => setMinYield(event.target.value)} disabled={Boolean(deal.intentId)} inputMode="decimal" /></label>
              <label><span className={labelClass}>Maximum loss / %</span><input className={inputClass} value={maxLoss} onChange={(event) => setMaxLoss(event.target.value)} disabled={Boolean(deal.intentId)} inputMode="decimal" /></label>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-on-surface p-4">
              <div className="min-w-0 font-code-sm"><span className="text-secondary">COMMITMENT </span><strong className="break-all">{deal.policyCommitment ? shortHash(deal.policyCommitment) : "GENERATED AT SUBMISSION"}</strong></div>
              <div className="flex flex-wrap gap-2">
                {deal.policyCommitment && <button type="button" className={actionClass} onClick={copyPolicy}><Clipboard size={16} />CRE secret</button>}
                <button type="button" className={actionClass} onClick={createIntent} disabled={busy || Boolean(deal.intentId)}><Send size={16} />Create intent</button>
              </div>
            </footer>
          </section>

          <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
            <header className="flex items-center justify-between border-b-2 border-on-surface bg-surface-container-high px-4 py-3">
              <div><p className="font-label-caps text-label-caps font-bold text-primary">02 / PRINCIPAL + COUNTERPARTY</p><h2 className="font-headline-sm text-headline-sm font-bold">Open and negotiate</h2></div>
              <WalletCards size={22} aria-hidden="true" />
            </header>
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <label><span className={labelClass}>Intent ID</span><input className={inputClass} value={deal.intentId} onChange={(event) => update("intentId", event.target.value)} placeholder="0x…" /></label>
                <label><span className={labelClass}>Agreement ID</span><input className={inputClass} value={deal.agreementId} onChange={(event) => update("agreementId", event.target.value)} placeholder="Created after OPEN" /></label>
                <label><span className={labelClass}>Principal</span><input className={inputClass} value={deal.principal} onChange={(event) => update("principal", event.target.value)} placeholder="0x…" /></label>
                <label><span className={labelClass}>Counterparty</span><input className={inputClass} value={deal.counterparty} onChange={(event) => update("counterparty", event.target.value)} placeholder="0x…" /></label>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-on-surface pt-4">
                <button type="button" className={actionClass} onClick={openAgreement} disabled={busy || !deal.intentId || Boolean(deal.agreementId)}><LockKeyhole size={16} />Open agreement</button>
                <button type="button" className={actionClass} onClick={beginNegotiation} disabled={busy || !deal.agreementId || !deal.counterparty}><RefreshCw size={16} />Begin negotiation</button>
              </div>
            </div>
          </section>

          <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
            <header className="flex items-center justify-between border-b-2 border-on-surface bg-surface-container-high px-4 py-3">
              <div><p className="font-label-caps text-label-caps font-bold text-primary">03 / SIGN + VALIDATE</p><h2 className="font-headline-sm text-headline-sm font-bold">Canonical public terms</h2></div>
              <FileSignature size={22} aria-hidden="true" />
            </header>
            <div className="grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
              <label><span className={labelClass}>Duration / days</span><input className={inputClass} value={deal.durationDays} onChange={(event) => update("durationDays", event.target.value)} inputMode="numeric" /></label>
              <label><span className={labelClass}>Yield / % APR</span><input className={inputClass} value={deal.yieldPercent} onChange={(event) => update("yieldPercent", event.target.value)} inputMode="decimal" /></label>
              <label><span className={labelClass}>Expiry / hours</span><input className={inputClass} value={deal.expiryHours} onChange={(event) => update("expiryHours", event.target.value)} inputMode="numeric" /></label>
              <label><span className={labelClass}>Offer nonce</span><input className={inputClass} value={deal.nonce} onChange={(event) => update("nonce", event.target.value)} inputMode="numeric" /></label>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-on-surface p-4">
              <div className="font-code-sm"><span className="text-secondary">SIGNER </span><strong>{deal.counterparty ? shortHash(deal.counterparty) : "COUNTERPARTY REQUIRED"}</strong></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={actionClass} onClick={signTerms} disabled={busy || !deal.agreementId || !deal.counterparty}><FileSignature size={16} />Sign EIP-712</button>
                <button type="button" className={`${actionClass} !bg-primary-container`} onClick={finalizeAgreement} disabled={busy || !deal.signature || validationRequested}><ShieldCheck size={16} />{validationRequested ? "CRE requested" : "Submit for CRE"}</button>
              </div>
            </footer>
            {deal.finalizeTx && <a className="flex items-center justify-between border-t-2 border-on-surface px-4 py-3 font-code-sm font-bold" href={`${canonical.sepolia.explorer}/tx/${deal.finalizeTx}`} target="_blank" rel="noreferrer">Validation request {shortHash(deal.finalizeTx)}<ExternalLink size={15} /></a>}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="border-2 border-on-surface bg-on-surface text-white neo-shadow-lg">
            <header className="border-b border-white/30 p-4"><p className="font-label-caps text-label-caps text-primary-fixed-dim">CONNECTED ROLE</p><h2 className="mt-1 break-all font-code-md font-bold">{account ? shortHash(account) : "NO WALLET"}</h2></header>
            <dl className="grid grid-cols-2 gap-px bg-white/20 font-code-sm">
              <div className="min-w-0 bg-on-surface p-4"><dt className="text-white/60">PRINCIPAL</dt><dd className={`mt-1 truncate font-bold ${sameAddress(account, deal.principal) ? "text-tertiary-fixed" : ""}`}>{deal.principal ? shortHash(deal.principal) : "NOT SET"}</dd><span className="mt-1 block text-[11px] text-white/60">{sameAddress(account, deal.principal) ? "ACTIVE WALLET" : "CONFIGURED"}</span></div>
              <div className="min-w-0 bg-on-surface p-4"><dt className="text-white/60">COUNTERPARTY</dt><dd className={`mt-1 truncate font-bold ${sameAddress(account, deal.counterparty) ? "text-tertiary-fixed" : ""}`}>{deal.counterparty ? shortHash(deal.counterparty) : "NOT SET"}</dd><span className="mt-1 block text-[11px] text-white/60">{sameAddress(account, deal.counterparty) ? "ACTIVE WALLET" : deal.counterparty ? "CONFIGURED" : "AWAITING ADDRESS"}</span></div>
            </dl>
          </section>

          <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
            <header className="border-b-2 border-on-surface bg-surface-container-high p-4"><p className="font-label-caps text-label-caps font-bold text-primary">ARC / PRINCIPAL</p><h2 className="font-headline-sm font-bold">Escrow allowance</h2></header>
            <div className="space-y-4 p-4">
              <div className="border border-on-surface bg-surface-container p-3 font-code-sm"><span className="text-secondary">ESCROW </span><strong>{shortHash(canonical.arcTestnet.sovereignEscrow)}</strong></div>
              <button type="button" className={`${actionClass} w-full`} onClick={approveEscrow} disabled={busy || !deal.principal || !deal.agreementId}><LockKeyhole size={16} />Approve exact capital</button>
              {deal.approvalTx && <a className="flex items-center justify-between border border-on-surface p-3 font-code-sm font-bold" href={`${canonical.arcTestnet.explorer}/tx/${deal.approvalTx}`} target="_blank" rel="noreferrer">Approval {shortHash(deal.approvalTx)}<ExternalLink size={15} /></a>}
            </div>
          </section>

          <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
            <header className="flex items-center justify-between border-b-2 border-on-surface bg-surface-container-high p-4"><div><p className="font-label-caps text-label-caps font-bold text-primary">PUBLIC FINALITY</p><h2 className="font-headline-sm font-bold">Protocol handoff</h2></div><button type="button" onClick={refreshStatus} disabled={busy || !deal.agreementId} className="border-2 border-on-surface bg-white p-2 neo-press" title="Refresh finalized chain state"><RefreshCw size={17} /></button></header>
            <dl className="divide-y-2 divide-on-surface font-code-sm">
              <div className="flex items-center justify-between gap-3 p-4"><dt>Sepolia registry</dt><dd className="text-right font-bold text-primary">{snapshot?.chains.sepolia.state ?? "NOT READ"}{snapshot?.latest && snapshot.latest.sepolia.state !== snapshot.chains.sepolia.state && <span className="block text-[11px] text-secondary">LATEST: {snapshot.latest.sepolia.state}</span>}</dd></div>
              <div className="flex items-center justify-between gap-3 p-4"><dt>Arc escrow</dt><dd className="text-right font-bold text-tertiary">{snapshot?.chains.arc.state ?? "NOT READ"}{snapshot?.latest && snapshot.latest.arc.state !== snapshot.chains.arc.state && <span className="block text-[11px] text-secondary">LATEST: {snapshot.latest.arc.state}</span>}</dd></div>
              <div className="p-4 text-secondary">CRE: scheduled simulation broadcast<br />Escrow writes: authorized relayer</div>
            </dl>
          </section>

          <button type="button" onClick={resetWorkspace} className="w-full border-2 border-on-surface bg-surface-container-lowest px-4 py-3 font-code-sm font-bold neo-press">Clear local workspace</button>
        </aside>
      </div>
    </div>
  );
}
