import Link from "next/link";
import { ExternalLink, LockKeyhole } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import canonical from "../../../../deployments/canonical.json";
import { readLiveAgreement } from "@/lib/server/live-ledger";
import { ESCROW_STATES, REGISTRY_STATES } from "@/lib/server/public-status";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const rehearsal = canonical.rehearsal;
  let live: Awaited<ReturnType<typeof readLiveAgreement>> | null = null;
  try { live = await readLiveAgreement(rehearsal.agreementId as `0x${string}`); } catch { live = null; }
  const events = [
    ["Sepolia", "Validation accepted", rehearsal.sepolia.activation],
    ["Sepolia", "Breach accepted", rehearsal.sepolia.breach],
    ["Arc", "Escrow locked", rehearsal.arcTestnet.escrowLocked],
    ["Arc", "Escrow unwound", rehearsal.arcTestnet.escrowUnwound],
    ["Sepolia", "Agreement marked unwinding", rehearsal.sepolia.markUnwinding],
    ["Sepolia", "Agreement settled", rehearsal.sepolia.markSettled],
  ] as const;
  return <div className="space-y-unit-6"><section className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-on-surface pb-unit-5 gap-unit-4"><div><span className="font-label-caps text-label-caps bg-on-surface text-surface-container-lowest px-unit-2 py-0.5 tracking-widest font-bold">LIVE ACTIVITY</span><h1 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight mt-2">Activity Ledger</h1><p className="font-body-md text-body-md text-secondary mt-1">Recorded transaction receipts from the canonical cross-chain rehearsal.</p></div><div className="border border-on-surface bg-surface-container-lowest px-unit-4 py-unit-2 neo-shadow"><div className="font-label-caps text-label-caps text-secondary font-bold">RECEIPTS</div><div className="font-code-md text-code-md font-bold text-on-surface">{events.length}</div></div></section><section className="border-2 border-on-surface bg-surface-container-lowest p-unit-4 neo-shadow"><div className="font-label-caps text-label-caps font-bold">AGREEMENT</div><Link href={`/agreements/${rehearsal.agreementId}`} className="font-code-sm text-code-sm mt-2 break-all underline">{rehearsal.agreementId}</Link>{live && <div className="mt-3 font-code-sm">Finalized reads: <StatusBadge status={REGISTRY_STATES[live.registryState]} /> <StatusBadge status={ESCROW_STATES[live.escrowState]} /></div>}</section><section className="bg-surface-container-lowest border-2 border-on-surface neo-shadow-lg overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="bg-surface-container border-b-2 border-on-surface font-label-caps text-label-caps text-secondary"><th className="py-unit-3 px-unit-4">Chain / Step</th><th className="py-unit-3 px-unit-4">Block</th><th className="py-unit-3 px-unit-4">Transaction</th><th className="py-unit-3 px-unit-4 text-right">Open</th></tr></thead><tbody>{events.map(([chain, step, entry]) => <tr key={entry.tx} className="border-b border-surface-container-highest font-code-sm"><td className="py-unit-4 px-unit-4"><strong>{chain}</strong><div className="text-secondary">{step}</div></td><td className="py-unit-4 px-unit-4">{entry.block}</td><td className="py-unit-4 px-unit-4 break-all">{entry.tx}</td><td className="py-unit-4 px-unit-4 text-right"><a href={`${chain === "Arc" ? canonical.arcTestnet.explorer : canonical.sepolia.explorer}/tx/${entry.tx}`} target="_blank" rel="noreferrer noopener" title="Open transaction in explorer"><ExternalLink size={16} /></a></td></tr>)}</tbody></table></section><div className="flex items-center gap-unit-2 font-code-sm text-secondary"><LockKeyhole size={14} /> FINALIZED PUBLIC RECEIPTS · SEPOLIA + ARC</div></div>;
}
