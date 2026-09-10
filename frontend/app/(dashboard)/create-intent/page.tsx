import Link from "next/link";

export default function CreateIntentPage() {
  return (
    <div className="space-y-unit-6">
      <section className="border-b-2 border-on-surface pb-unit-5">
        <p className="font-code-sm text-secondary">DEMO / SYNTHETIC — NON-INTERACTIVE PREVIEW</p>
        <h1 className="font-headline-lg text-headline-lg font-bold">Intent Preview</h1>
        <p className="text-secondary mt-2">Illustrative public terms only. No intent is created, saved, signed, or deployed.</p>
      </section>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-unit-6">
        <section className="lg:col-span-2 border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow-lg">
          <h2 className="font-headline-sm font-bold border-b-2 border-on-surface pb-4">Synthetic public intent parameters</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6 font-code-md">
            <div><dt className="text-secondary text-sm">Agreement type</dt><dd className="font-bold">Collateralized loan (example)</dd></div>
            <div><dt className="text-secondary text-sm">Principal asset</dt><dd className="font-bold">USDC (synthetic)</dd></div>
            <div><dt className="text-secondary text-sm">Principal amount</dt><dd className="font-bold">100,000 (example)</dd></div>
            <div><dt className="text-secondary text-sm">Public offer yield</dt><dd className="font-bold">8.40% APR (example)</dd></div>
            <div><dt className="text-secondary text-sm">Public offer duration</dt><dd className="font-bold">25 days (example)</dd></div>
          </dl>
        </section>
        <aside className="border-2 border-dashed border-on-surface bg-surface-container-high p-unit-6 space-y-4">
          <h2 className="font-headline-sm font-bold">Private policy input disabled</h2>
          <p>Keep real policies local, outside this public UI. Do not enter private limits, salts, keys, or feed credentials into the browser.</p>
          <p className="text-sm text-secondary">No private input controls, commitment generation, or policy submission are provided. This preview makes no encryption or enclave claim.</p>
        </aside>
      </div>
      <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 flex flex-wrap gap-4 items-center justify-between">
        <p className="text-sm text-secondary">Viewing examples does not start agents or send transactions.</p>
        <Link href="/agreements" className="border-2 border-on-surface bg-primary-container text-on-primary px-5 py-3 font-code-sm font-bold neo-press">Browse demo agreements</Link>
      </section>
    </div>
  );
}
