import Link from "next/link";
import { ArrowRight } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import { AGREEMENTS } from "@/lib/mock-data";
import canonical from "../../../../deployments/canonical.json";

export default function AgreementsPage() {
  return (
    <div className="space-y-unit-6">
      {/* Header & Stats Strip */}
      <section className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-on-surface pb-unit-5 gap-unit-4">
        <div>
          <div className="flex items-center gap-unit-2 mb-unit-1">
            <span className="font-label-caps text-label-caps bg-on-surface text-surface-container-lowest px-unit-2 py-0.5 tracking-widest font-bold">
              AGREEMENT LEDGER
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight">
            Agreements
          </h1>
          <p className="font-body-md text-body-md text-secondary mt-1 max-w-2xl">
            Public agreement terms. Private policy values and risk evaluations are never shown here.
          </p>
        </div>
        <div className="flex items-center gap-unit-3">
          <div className="border border-on-surface bg-surface-container-lowest px-unit-4 py-unit-2 flex flex-col items-center justify-center neo-shadow">
            <div className="font-label-caps text-label-caps text-secondary font-bold">TOTAL PRINCIPAL</div>
            <div className="font-code-md text-code-md font-bold text-on-surface">$500,000.00</div>
          </div>
          <div className="border border-on-surface bg-surface-container-lowest px-unit-4 py-unit-2 flex flex-col items-center justify-center neo-shadow">
            <div className="font-label-caps text-label-caps text-secondary font-bold">ACTIVE AGREEMENTS</div>
            <div className="font-code-md text-code-md font-bold text-primary">01</div>
          </div>
        </div>
      </section>

      <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-4 neo-shadow">
        <p className="font-label-caps text-label-caps font-bold">LIVE ONCHAIN AGREEMENT</p>
        <p className="font-code-sm text-code-sm mt-2 break-all">
          <Link href={`/agreements/${canonical.rehearsal.agreementId}`} className="underline">
            {canonical.rehearsal.agreementId}
          </Link>
        </p>
        <p className="font-body-md text-body-md text-secondary mt-2">
          Completed the full lifecycle on Sepolia and Arc. Opening it performs finalized public reads against the deployed
          registries.
        </p>
      </section>

      <p className="border-2 border-on-surface bg-surface-container-lowest p-unit-4 font-code-sm text-code-sm">
        Open any agreement by its bytes32 identifier for finalized onchain state, or use <Link href="/monitoring" className="underline">Public Status</Link> to look one up directly.
      </p>

      {/* Ledger Table */}
      <section className="bg-surface-container-lowest border-2 border-on-surface neo-shadow-lg overflow-x-auto">
        <div className="bg-surface-container-high border-b-2 border-on-surface px-unit-4 py-unit-2 flex items-center justify-between font-label-caps text-label-caps">
          <div className="flex items-center gap-2 font-bold text-on-surface">
            <span>TABLE VIEW:</span>
            <span className="text-secondary">PUBLIC TERMS</span>
          </div>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container border-b-2 border-on-surface font-label-caps text-label-caps uppercase text-secondary">
              <th className="py-unit-3 px-unit-4 font-bold border-r border-surface-container-highest">Agreement ID</th>
              <th className="py-unit-3 px-unit-4 font-bold border-r border-surface-container-highest">Counterparty</th>
              <th className="py-unit-3 px-unit-4 font-bold border-r border-surface-container-highest">Capital (USDC)</th>
              <th className="py-unit-3 px-unit-4 font-bold border-r border-surface-container-highest">Agreed Yield</th>
              <th className="py-unit-3 px-unit-4 font-bold border-r border-surface-container-highest text-center">Status</th>
              <th className="py-unit-3 px-unit-4 font-bold text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container-highest font-body-sm text-body-sm">
            {AGREEMENTS.map((agreement) => (
              <tr key={agreement.id} className="ledger-row">
                <td className="py-unit-3 px-unit-4 border-r border-surface-container-highest">
                  <div className="font-code-md text-code-md font-bold text-on-surface">{agreement.id}</div>
                  <div className="font-label-caps text-label-caps text-secondary mt-1">{agreement.type}</div>
                </td>
                <td className="py-unit-3 px-unit-4 border-r border-surface-container-highest">
                  <div className="font-code-sm text-code-sm font-semibold text-primary">{agreement.partyB.name}</div>
                  <div className="font-label-caps text-label-caps text-secondary mt-1">COUNTERPARTY</div>
                </td>
                <td className="py-unit-3 px-unit-4 border-r border-surface-container-highest">
                  <div className="font-num-table text-num-table font-bold text-on-surface">
                    ${agreement.principal.toLocaleString()}.00
                  </div>
                  <div className="font-label-caps text-label-caps text-secondary mt-1">DURATION: {agreement.duration}D</div>
                </td>
                <td className="py-unit-3 px-unit-4 border-r border-surface-container-highest">
                  <div className="font-code-md text-code-md font-bold text-tertiary">{agreement.yield.toFixed(2)}% APR</div>
                  <div className="font-label-caps text-label-caps mt-1 text-secondary">NOT EARNED YIELD</div>
                </td>
                <td className="py-unit-3 px-unit-4 border-r border-surface-container-highest text-center">
                  <StatusBadge status={agreement.status} />
                </td>
                <td className="py-unit-3 px-unit-4 text-right">
                  <Link
                    href={`/agreements/${agreement.id}`}
                    className="inline-flex items-center gap-1 font-code-sm text-code-sm font-bold text-on-surface border border-on-surface px-unit-3 py-1 bg-surface-container-lowest hover:bg-surface-container neo-shadow-sm neo-press"
                  >
                    INSPECT <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
