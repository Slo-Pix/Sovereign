"use client";

import { useEffect, useRef, useState } from "react";

const AGREEMENT_ID = /^0x[0-9a-fA-F]{64}$/;
const UNAVAILABLE = "Public status unavailable. Check the agreement ID and service configuration, then try again.";
const REGISTRY_STATES = ["NONE", "OPEN", "NEGOTIATING", "PENDING_VALIDATION", "ACTIVE", "BREACHED", "UNWIND", "SETTLED", "CANCELLED", "REJECTED"];
const ESCROW_STATES = ["NONE", "ACTIVE", "UNWOUND", "SETTLED"];

type ChainSnapshot = { chainId: number | string; blockNumber: string; state: string };
type PublicStatus = {
  agreementId: string;
  chains: { sepolia: ChainSnapshot; arc: ChainSnapshot };
  evidenceMode: "LIVE_RPC_READS";
  warning: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChain(value: unknown, chainId: number, states: string[]): value is ChainSnapshot {
  return isObject(value)
    && (value.chainId === chainId || value.chainId === String(chainId))
    && typeof value.blockNumber === "string"
    && /^(0|[1-9][0-9]{0,77})$/.test(value.blockNumber)
    && typeof value.state === "string"
    && states.includes(value.state);
}

// Never dump arbitrary JSON or private fields into the page. Only the public
// response contract is accepted; optional receiverReady is not evidence.
function parseStatus(value: unknown, id: string): PublicStatus | null {
  if (!isObject(value)
    || typeof value.agreementId !== "string"
    || !AGREEMENT_ID.test(value.agreementId)
    || value.agreementId.toLowerCase() !== id.toLowerCase()
    || value.evidenceMode !== "LIVE_RPC_READS"
    || typeof value.warning !== "string"
    || value.warning.length > 2000
    || !isObject(value.chains)
    || !isChain(value.chains.sepolia, 11155111, REGISTRY_STATES)
    || !isChain(value.chains.arc, 5042002, ESCROW_STATES)) return null;

  const copyChain = (chain: ChainSnapshot): ChainSnapshot => ({
    chainId: chain.chainId,
    blockNumber: chain.blockNumber,
    state: chain.state,
  });
  return {
    agreementId: value.agreementId,
    evidenceMode: "LIVE_RPC_READS",
    warning: value.warning,
    chains: { sepolia: copyChain(value.chains.sepolia), arc: copyChain(value.chains.arc) },
  };
}

export default function PublicAgreementStatus() {
  const [agreementId, setAgreementId] = useState("");
  const [snapshot, setSnapshot] = useState<PublicStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  function changeId(value: string) {
    request.current?.abort();
    request.current = null;
    setAgreementId(value);
    setSnapshot(null);
    setError(null);
    setPending(false);
  }

  async function readStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    request.current?.abort();
    request.current = null;
    setSnapshot(null);
    setError(null);
    setPending(false);
    const id = agreementId.trim();
    if (!AGREEMENT_ID.test(id)) {
      setError(UNAVAILABLE);
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/api/agreements/${encodeURIComponent(id)}/status`, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Unavailable");
      const result = parseStatus(await response.json(), id);
      if (!result) throw new Error("Unavailable");
      if (request.current === controller && !controller.signal.aborted) setSnapshot(result);
    } catch {
      if (request.current === controller) setError(UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <div className="space-y-unit-6">
      <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow">
        <form onSubmit={readStatus} className="space-y-3">
          <label htmlFor="agreement-id" className="block font-code-md font-bold">Public agreement ID (bytes32)</label>
          <p id="agreement-id-help" className="text-sm text-secondary">
            Use 0x followed by 64 hexadecimal characters. Demo IDs such as SOV-8F29 are not onchain IDs.
            No wallet is required. Do not enter policies, credentials, or private feed data.
          </p>
          <input
            id="agreement-id"
            type="text"
            value={agreementId}
            onChange={(event) => changeId(event.target.value)}
            aria-describedby="agreement-id-help"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="0x… (64 hex characters)"
            className="w-full border-2 border-on-surface bg-surface-container-low p-3 font-mono text-sm"
          />
          <button type="submit" disabled={pending} className="border-2 border-on-surface bg-primary-container text-on-primary px-5 py-3 font-code-sm font-bold neo-press disabled:opacity-50">
            {pending ? "Reading public status…" : "Read / refresh public status"}
          </button>
        </form>
      </section>

      <aside className="border-2 border-on-surface bg-surface-container-high p-unit-4">
        <p className="font-code-md font-bold">ACTIVE ≠ fresh SAFE</p>
        <p className="mt-2 text-sm">
          ACTIVE is a public lifecycle state, not a recent risk evaluation or assurance of solvency.
          Absence of a breach does not establish safety. These independent chain snapshots do not
          prove relay execution, settlement receipts, receiver readiness, or hardware attestation.
        </p>
        <p className="mt-2 text-sm">Private evaluation outputs and history are not requested or displayed. Refresh is manual; snapshots are not a live stream.</p>
      </aside>

      <div aria-live="polite" aria-busy={pending}>
        {error && <p role="alert" className="border-2 border-on-surface bg-surface-container-lowest p-4">{error}</p>}
        {!snapshot && !pending && !error && <p className="text-secondary">No RPC result loaded. No demo fallback is used here.</p>}
        {snapshot && (
          <section className="space-y-4">
            <div className="border-2 border-on-surface bg-surface-container-lowest p-4">
              <h2 className="font-code-md font-bold">LIVE_RPC_READS / PUBLIC SNAPSHOT ONLY</h2>
              <p className="font-mono text-sm break-all mt-2">Agreement: {snapshot.agreementId}</p>
              <p className="text-sm text-secondary mt-2">State at the reported blocks; may be stale after this read. No transaction was sent.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-unit-4">
              {(["sepolia", "arc"] as const).map((name) => (
                <section key={name} className="border-2 border-on-surface bg-surface-container-lowest p-unit-5 neo-shadow">
                  <h3 className="font-headline-sm font-bold uppercase">{name} / {name === "sepolia" ? "Registry" : "Escrow"}</h3>
                  <dl className="font-code-sm text-sm mt-4 space-y-3">
                    <div><dt className="text-secondary">Chain ID</dt><dd>{snapshot.chains[name].chainId}</dd></div>
                    <div><dt className="text-secondary">Block number</dt><dd className="break-all">{snapshot.chains[name].blockNumber}</dd></div>
                    <div><dt className="text-secondary">Public contract state</dt><dd className="font-bold">{snapshot.chains[name].state}</dd></div>
                  </dl>
                </section>
              ))}
            </div>
            {snapshot.warning && <p className="border border-on-surface bg-surface-container-high p-4 text-sm break-words">Service warning: {snapshot.warning}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
