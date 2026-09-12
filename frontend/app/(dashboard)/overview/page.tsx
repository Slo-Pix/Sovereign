import Link from "next/link";
import { ArrowRight, Bot, History, LockKeyhole, Plus } from "lucide-react";
import { indexLiveAgreements } from "@/lib/server/live-ledger";
import { ESCROW_STATES, REGISTRY_STATES } from "@/lib/server/public-status";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let index: Awaited<ReturnType<typeof indexLiveAgreements>> | null = null;
  try { index = await indexLiveAgreements(); } catch { index = null; }
  const agreement = index?.agreements.find((candidate) => candidate.capital > 0n && candidate.duration > 0n) ?? null;

  const amount = agreement ? Number(agreement.capital) / 1_000_000 : null;
  const metrics = [
    ["PRINCIPAL", amount === null ? "UNAVAILABLE" : `$${amount.toLocaleString()} USDC`, LockKeyhole],
    ["REGISTRY", agreement ? REGISTRY_STATES[agreement.registryState] : "UNAVAILABLE", History],
    ["ESCROW", agreement ? ESCROW_STATES[agreement.escrowState] : "UNAVAILABLE", Bot],
  ] as const;

  return (
    <div className="space-y-unit-6">
      <section className="flex flex-col justify-between gap-unit-4 border-b-2 border-on-surface pb-unit-5 md:flex-row md:items-end">
        <div>
          <span className="bg-on-surface px-unit-2 py-0.5 font-label-caps text-label-caps tracking-widest text-surface-container-lowest">
            LIVE OVERVIEW
          </span>
          <h1 className="mt-2 font-headline-lg font-bold tracking-tight text-headline-lg text-on-surface">Control Plane Overview</h1>
          <p className="mt-1 max-w-2xl font-body-md text-body-md text-secondary">
            Public terms and finalized state discovered from the deployed registry. Private policy values and evaluations are never displayed.
          </p>
        </div>
        <Link href="/create-intent" className="flex items-center gap-2 border-2 border-on-surface bg-primary-container px-unit-6 py-unit-3 font-code-md font-bold text-on-primary">
          <Plus size={16} aria-hidden="true" /> NEW INTENT
        </Link>
      </section>

      <section className="grid grid-cols-1 gap-unit-4 md:grid-cols-3">
        {metrics.map(([label, value, Icon]) => (
          <div key={label} className="neo-shadow border border-on-surface bg-surface-container-lowest p-unit-5">
            <div className="font-label-caps font-bold text-label-caps text-secondary">{label}</div>
            <div className="mt-2 font-num-display font-bold text-num-display">{value}</div>
            <div className="mt-2 flex items-center gap-1 font-code-sm text-secondary">
              <Icon size={14} aria-hidden="true" /> FINALIZED READ
            </div>
          </div>
        ))}
      </section>

      {agreement ? (
        <section className="neo-shadow-lg border-2 border-on-surface bg-surface-container-lowest p-unit-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row">
            <div>
              <div className="font-label-caps font-bold text-label-caps text-primary">LATEST AGREEMENT WITH TERMS</div>
              <h2 className="mt-1 break-all font-headline-md font-bold">{agreement.id}</h2>
              <p className="mt-2 font-code-sm text-secondary">{agreement.principal} ↔ {agreement.counterparty}</p>
            </div>
            <Link href={`/agreements/${agreement.id}`} className="inline-flex items-center gap-2 self-start border-2 border-on-surface px-4 py-2 font-code-sm font-bold">
              VIEW TERMS <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 border-t border-on-surface pt-5 font-code-sm md:grid-cols-3">
            <div><span className="text-secondary">CAPITAL</span><strong className="block text-xl">{amount?.toLocaleString()} USDC</strong></div>
            <div><span className="text-secondary">YIELD</span><strong className="block text-xl text-primary">{(Number(agreement.yieldBps) / 100).toFixed(2)}% APR</strong></div>
            <div><span className="text-secondary">DURATION</span><strong className="block text-xl">{Number(agreement.duration) / 86400} DAYS</strong></div>
          </div>
        </section>
      ) : (
        <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6">
          <h2 className="font-headline-sm font-bold">Live data unavailable</h2>
          <p className="mt-2 text-secondary">No indexed agreement with finalized public terms is available. Open agreements remain visible in the Agreements ledger.</p>
        </section>
      )}
    </div>
  );
}
