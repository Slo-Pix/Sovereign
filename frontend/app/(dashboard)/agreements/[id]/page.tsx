import { notFound } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/ui/StatusBadge";
import { AGREEMENTS } from "@/lib/mock-data";

export default async function AgreementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agreement = AGREEMENTS.find((item) => item.id === id);
  if (!agreement) notFound();

  return (
    <div className="space-y-unit-6">
      <section className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-on-surface pb-unit-5">
        <div>
          <p className="font-code-sm text-secondary">DEMO / SYNTHETIC AGREEMENT</p>
          <h1 className="font-headline-lg text-headline-lg font-bold">Agreement {agreement.id}</h1>
          <p className="text-secondary mt-2">Public-term illustration only. This ID is not an onchain bytes32 identifier.</p>
        </div>
        <StatusBadge status={agreement.status} />
      </section>
      <section className="border-2 border-on-surface bg-surface-container-lowest neo-shadow-lg">
        <h2 className="border-b-2 border-on-surface bg-surface-container-high p-4 font-code-md font-bold">SYNTHETIC PUBLIC TERMS / NO FUNDS DEPOSITED</h2>
        <dl className="grid grid-cols-1 md:grid-cols-3 gap-6 p-unit-6">
          <div><dt className="font-code-sm text-secondary">Example principal</dt><dd className="font-num-display text-num-display font-bold">${agreement.principal.toLocaleString()}</dd><dd>{agreement.principalAsset} (synthetic)</dd></div>
          <div><dt className="font-code-sm text-secondary">Example agreed yield</dt><dd className="font-num-display text-num-display font-bold">{agreement.yield.toFixed(2)}%</dd><dd>APR illustration, not earned yield</dd></div>
          <div><dt className="font-code-sm text-secondary">Example duration</dt><dd className="font-num-display text-num-display font-bold">{agreement.duration}</dd><dd>Days, not a countdown</dd></div>
        </dl>
      </section>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-unit-6">
        <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow">
          <h2 className="font-headline-sm font-bold">Illustrative counterparties</h2>
          <p className="mt-3">{agreement.partyA.name} ↔ {agreement.partyB.name}</p>
          <p className="text-sm text-secondary mt-3">No wallet identity, delegation, signature, or hardware verification is attached to this fixture.</p>
        </section>
        <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow">
          <h2 className="font-headline-sm font-bold">Evidence not available for fixtures</h2>
          <p className="text-sm text-secondary mt-3">No private policy, risk output, proof, or transaction receipt is displayed. Fixture status is not a risk assessment or a claim of settlement.</p>
        </section>
      </div>
      <div className="flex flex-wrap gap-4">
        <Link href="/agreements" className="border-2 border-on-surface px-5 py-3 font-code-sm neo-press">Back to demo agreements</Link>
        <Link href="/monitoring" className="border-2 border-on-surface bg-primary-container text-on-primary px-5 py-3 font-code-sm neo-press">Read public status with your own onchain ID</Link>
      </div>
    </div>
  );
}
