import { notFound } from "next/navigation";
import Link from "next/link";
import canonical from "../../../../../deployments/canonical.json";
import {
  ESCROW_STATES,
  REGISTRY_STATES,
  readPublicSnapshots,
  validAgreementId,
} from "@/lib/server/public-status";

export const dynamic = "force-dynamic";

export default async function AgreementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validAgreementId(id)) notFound();
  return <LiveAgreement id={id.toLowerCase() as `0x${string}`} />;
}

async function LiveAgreement({ id }: { id: `0x${string}` }) {
  let snapshot: Awaited<ReturnType<typeof readPublicSnapshots>> | null = null;
  try {
    snapshot = await readPublicSnapshots(id);
  } catch {
    // Provider errors can contain RPC credentials, and fixtures must never stand in for live state.
    snapshot = null;
  }

  const rehearsal = canonical.rehearsal.agreementId.toLowerCase() === id ? canonical.rehearsal : null;

  return (
    <div className="space-y-unit-6">
      <section className="border-b-2 border-on-surface pb-unit-5">
        <p className="font-code-sm text-secondary">LIVE ONCHAIN AGREEMENT / FINALIZED PUBLIC READS</p>
        <h1 className="font-headline-lg text-headline-lg font-bold break-all">{id}</h1>
        <p className="text-secondary mt-2">
          Read directly from the deployed registries at the finalized block on each chain. No private policy value,
          position reading, or risk output is retrieved or displayed.
        </p>
      </section>

      {snapshot ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-unit-6">
          <ChainCard
            label="Sepolia — AgreementRegistry"
            chainId={snapshot.sepolia.chainId}
            blockNumber={snapshot.sepolia.blockNumber}
            state={REGISTRY_STATES[snapshot.sepolia.state] ?? "UNKNOWN"}
            explorer={canonical.sepolia.explorer}
            contract={canonical.sepolia.agreementRegistry}
          />
          <ChainCard
            label="Arc testnet — SovereignEscrow"
            chainId={snapshot.arc.chainId}
            blockNumber={snapshot.arc.blockNumber}
            state={ESCROW_STATES[snapshot.arc.state] ?? "UNKNOWN"}
            explorer={canonical.arcTestnet.explorer}
            contract={canonical.arcTestnet.sovereignEscrow}
          />
        </div>
      ) : (
        <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow">
          <h2 className="font-headline-sm font-bold">Public status unavailable</h2>
          <p className="text-sm text-secondary mt-3">
            A finalized read could not be completed on both chains. No cached or substitute state is shown in its place.
            Retry once the configured RPC endpoints are reachable.
          </p>
        </section>
      )}

      {rehearsal && (
        <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
          <h2 className="border-b-2 border-on-surface bg-surface-container-high p-4 font-code-md font-bold">
            RECORDED LIFECYCLE / {rehearsal.mode.toUpperCase()}
          </h2>
          <div className="p-unit-6 space-y-4">
            <ol className="space-y-2 font-code-sm">
              <TxRow chain="Sepolia" step="Validation accepted" entry={rehearsal.sepolia.activation} explorer={canonical.sepolia.explorer} />
              <TxRow chain="Sepolia" step="Breach accepted" entry={rehearsal.sepolia.breach} explorer={canonical.sepolia.explorer} />
              <TxRow chain="Arc" step="Escrow locked" entry={rehearsal.arcTestnet.escrowLocked} explorer={canonical.arcTestnet.explorer} />
              <TxRow chain="Arc" step="Escrow unwound" entry={rehearsal.arcTestnet.escrowUnwound} explorer={canonical.arcTestnet.explorer} />
              <TxRow chain="Sepolia" step="Owner markUnwinding" entry={rehearsal.sepolia.markUnwinding} explorer={canonical.sepolia.explorer} />
              <TxRow chain="Sepolia" step="Owner markSettled" entry={rehearsal.sepolia.markSettled} explorer={canonical.sepolia.explorer} />
            </ol>
            <p className="text-sm text-secondary">{rehearsal.note}</p>
          </div>
        </section>
      )}

      <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow">
        <h2 className="font-headline-sm font-bold">What is deliberately absent</h2>
        <p className="text-sm text-secondary mt-3">
          Policy thresholds, position readings, distance to a threshold, and safe-evaluation history are never published.
          A safe evaluation produces no report and no transaction, so the absence of an entry above is itself the intended
          behaviour rather than missing data.
        </p>
      </section>

      <div className="flex flex-wrap gap-4">
        <Link href="/agreements" className="border-2 border-on-surface px-5 py-3 font-code-sm neo-press">Back to agreements</Link>
        <Link href="/monitoring" className="border-2 border-on-surface bg-primary-container text-on-primary px-5 py-3 font-code-sm neo-press">Read public status for another ID</Link>
      </div>
    </div>
  );
}

function ChainCard({ label, chainId, blockNumber, state, explorer, contract }: {
  label: string; chainId: number; blockNumber: bigint; state: string; explorer: string; contract: string;
}) {
  return (
    <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow">
      <h2 className="font-headline-sm font-bold">{label}</h2>
      <p className="font-num-display text-num-display font-bold mt-3">{state}</p>
      <dl className="mt-4 space-y-1 font-code-sm text-secondary">
        <div>Chain ID {chainId}</div>
        <div>Finalized block {blockNumber.toString()}</div>
        <div className="break-all">
          <a href={`${explorer}/address/${contract}`} rel="noreferrer noopener" target="_blank" className="underline">
            {contract}
          </a>
        </div>
      </dl>
    </section>
  );
}

function TxRow({ chain, step, entry, explorer }: {
  chain: string; step: string; entry: { block: number; tx: string }; explorer: string;
}) {
  return (
    <li className="break-all">
      <span className="font-bold">{chain}</span> · {step} · block {entry.block} ·{" "}
      <a href={`${explorer}/tx/${entry.tx}`} rel="noreferrer noopener" target="_blank" className="underline">
        {entry.tx}
      </a>
    </li>
  );
}
