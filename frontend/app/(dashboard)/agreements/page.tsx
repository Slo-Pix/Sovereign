import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import canonical from "../../../../deployments/canonical.json";
import { readLiveAgreement } from "@/lib/server/live-ledger";
import { REGISTRY_STATES } from "@/lib/server/public-status";

export const dynamic = "force-dynamic";

export default async function AgreementsPage() {
  const id = canonical.rehearsal.agreementId as `0x${string}`;
  let agreement: Awaited<ReturnType<typeof readLiveAgreement>> | null = null;
  try { agreement = await readLiveAgreement(id); } catch { agreement = null; }
  const state = agreement ? REGISTRY_STATES[agreement.registryState] : "UNAVAILABLE";
  return <div className="space-y-unit-6">
    <section className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-on-surface pb-unit-5 gap-unit-4"><div><span className="font-label-caps text-label-caps bg-on-surface text-surface-container-lowest px-unit-2 py-0.5 tracking-widest font-bold">AGREEMENT LEDGER</span><h1 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight mt-2">Agreements</h1><p className="font-body-md text-body-md text-secondary mt-1 max-w-2xl">Finalized public terms read from the deployed Sepolia registry and Arc escrow. No fixture rows are shown.</p></div><div className="border border-on-surface bg-surface-container-lowest px-unit-4 py-unit-2 neo-shadow"><div className="font-label-caps text-label-caps text-secondary font-bold">LIVE RECORDS</div><div className="font-code-md text-code-md font-bold text-primary">{agreement ? "01" : "00"}</div></div></section>
    <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-4 neo-shadow"><p className="font-label-caps text-label-caps font-bold">RECORDED REHEARSAL</p><p className="font-code-sm text-code-sm mt-2 break-all"><Link href={`/agreements/${id}`} className="underline">{id}</Link></p><p className="font-body-md text-body-md text-secondary mt-2">Canonical rehearsal transaction data is linked below. Refresh the page to read finalized chain state again.</p></section>
    {agreement ? <section className="bg-surface-container-lowest border-2 border-on-surface neo-shadow-lg overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="bg-surface-container border-b-2 border-on-surface font-label-caps text-label-caps text-secondary"><th className="py-unit-3 px-unit-4">Agreement ID</th><th className="py-unit-3 px-unit-4">Counterparty</th><th className="py-unit-3 px-unit-4">Capital</th><th className="py-unit-3 px-unit-4">Yield</th><th className="py-unit-3 px-unit-4">State</th><th className="py-unit-3 px-unit-4 text-right">Action</th></tr></thead><tbody><tr className="font-body-sm text-body-sm"><td className="py-unit-4 px-unit-4 font-code-sm break-all">{agreement.id}</td><td className="py-unit-4 px-unit-4 font-code-sm break-all text-primary">{agreement.counterparty}</td><td className="py-unit-4 px-unit-4 font-code-md font-bold">{(Number(agreement.capital) / 1_000_000).toLocaleString()} USDC</td><td className="py-unit-4 px-unit-4 font-code-md font-bold text-tertiary">{(Number(agreement.yieldBps) / 100).toFixed(2)}% APR</td><td className="py-unit-4 px-unit-4"><StatusBadge status={state} /></td><td className="py-unit-4 px-unit-4 text-right"><Link href={`/agreements/${agreement.id}`} className="inline-flex items-center gap-1 border border-on-surface px-unit-3 py-1 font-code-sm font-bold">INSPECT <ArrowRight size={14} /></Link></td></tr></tbody></table></section> : <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6"><RefreshCw size={18} /><h2 className="font-headline-sm font-bold mt-2">Live agreement unavailable</h2><p className="text-secondary mt-2">The finalized RPC read did not return the canonical agreement. No substitute data is displayed.</p></section>}
  </div>;
}
