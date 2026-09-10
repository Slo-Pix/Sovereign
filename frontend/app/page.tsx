import Link from "next/link";
import WalletConnection from "@/components/ui/WalletConnection";

const lifecycle = [
  ["01", "Public intent", "Browse synthetic public economic terms. No policy inputs are collected."],
  ["02", "Negotiation example", "Explore a static exchange of offers. No agents are started and no signatures are requested."],
  ["03", "Agreement example", "Inspect illustrative terms. Fixture states are not onchain confirmations."],
  ["04", "Public status", "Supply your own bytes32 agreement ID for a manual, read-only testnet RPC snapshot."],
];

export default function LandingPage() {
  return (
    <div className="bg-surface-container-low text-on-surface min-h-screen font-body-md">
      <header className="sticky top-0 z-30 border-b-2 border-on-surface bg-surface-container-low px-4 md:px-10 py-3 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3 font-headline-sm font-bold">
          <span className="w-8 h-8 bg-on-surface text-surface-container-lowest flex items-center justify-center">S</span>
          <span className="hidden sm:block">SOVEREIGN</span>
        </Link>
        <p className="font-code-sm text-[10px] md:text-sm font-bold">TESTNET / NO ATTESTATION CLAIM</p>
        <WalletConnection />
      </header>

      <main className="grid-bg">
        <section className="max-w-7xl mx-auto px-6 md:px-10 pt-12 pb-16 border-b-2 border-on-surface" id="overview">
          <div className="border-2 border-on-surface bg-surface-container-high p-4 mb-10 neo-shadow">
            <p className="font-code-md font-bold">DEMO / SYNTHETIC — ILLUSTRATIVE FEATURES ONLY</p>
            <p className="text-sm mt-2">No transactions, attestations, verified signatures, or live execution are represented by the examples. Wallet connection requests account access only; it is not protocol authorization.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7">
              <p className="font-code-sm uppercase tracking-widest mb-6">Agreement interface / testnet preview</p>
              <h1 className="font-display-lg text-display-lg md:text-[58px] md:leading-[62px] font-bold tracking-tight mb-6">
                Explore agreements.<br /><span className="underline decoration-primary-container decoration-4 underline-offset-8">Know the evidence.</span>
              </h1>
              <p className="font-body-lg text-body-lg text-secondary mb-8 max-w-xl">
                A synthetic walkthrough of public agreement terms, alongside a separate read-only view of public Sepolia and Arc contract state. No private evaluation results are exposed.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/overview" className="bg-primary-container text-on-primary border-2 border-on-surface px-6 py-3 font-code-md font-bold neo-shadow neo-press">Explore demo</Link>
                <Link href="/monitoring" className="bg-surface-container-lowest border-2 border-on-surface px-6 py-3 font-code-md font-bold neo-shadow neo-press">Read public status</Link>
              </div>
              <div className="grid grid-cols-3 gap-3 border-2 border-on-surface bg-surface-container-lowest p-4 mt-10">
                <div><p className="text-xs font-code-sm">FIXTURE AGREEMENTS</p><p className="text-3xl font-bold">03</p></div>
                <div><p className="text-xs font-code-sm">RPC TARGET CHAINS</p><p className="text-3xl font-bold">02</p></div>
                <div><p className="text-xs font-code-sm">TRANSACTIONS SENT BY UI</p><p className="text-3xl font-bold">00</p></div>
              </div>
            </div>
            <div className="lg:col-span-5 border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow-lg">
              <h2 className="font-code-md font-bold border-b-2 border-on-surface pb-3 mb-5">ILLUSTRATIVE WORKFLOW / NOT TELEMETRY</h2>
              <div className="space-y-4">
                {lifecycle.map(([step, title, description]) => (
                  <div key={step} className="border border-on-surface bg-surface-container-low p-4">
                    <p className="font-code-sm text-primary font-bold">{step} / {title}</p>
                    <p className="text-sm text-secondary mt-2">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 md:px-10 py-16" id="architecture">
          <p className="font-code-sm text-secondary mb-2">WHAT THIS INTERFACE DOES — AND DOES NOT — SHOW</p>
          <h2 className="font-headline-lg text-headline-lg font-bold mb-8">Public state, explicit limits.</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <article className="border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow">
              <h3 className="font-headline-sm font-bold">Synthetic examples</h3>
              <p className="mt-3 text-secondary">Metrics, counterparties, terms, and activity are fixtures. They do not establish balances, performance, settlement, or cryptographic verification.</p>
            </article>
            <article className="border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow">
              <h3 className="font-headline-sm font-bold">Read-only monitoring</h3>
              <p className="mt-3 text-secondary">A successful status request shows the agreement ID, chain IDs, public states, and block numbers. Errors never fall back to fixtures. ACTIVE does not establish fresh risk safety.</p>
            </article>
            <article className="border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow">
              <h3 className="font-headline-sm font-bold">No attestation claim</h3>
              <p className="mt-3 text-secondary">This UI supplies no ZK-SNARK proof, SGX verification, or TEE attestation. It does not establish a configured hardware enclave. Keep private policies and credentials outside this public UI.</p>
            </article>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 md:px-10 pb-20">
          <div className="border-2 border-on-surface bg-surface-container-lowest p-8 md:p-12 neo-shadow-lg">
            <p className="font-code-sm text-secondary mb-3">NO WALLET REQUIRED FOR PUBLIC READS</p>
            <h2 className="font-headline-lg text-headline-lg font-bold mb-4">Bring a public agreement ID.</h2>
            <p className="text-secondary max-w-2xl mb-6">Monitoring depends on a configured server and reachable testnet RPCs. Independent block snapshots are not evidence of private evaluation freshness, a completed relay, or a transaction receipt.</p>
            <Link href="/monitoring" className="inline-block border-2 border-on-surface bg-primary-container text-on-primary px-6 py-3 font-code-md font-bold neo-press">Open public monitoring</Link>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-on-surface px-6 md:px-10 py-8 flex flex-wrap justify-between gap-4 font-code-sm text-sm">
        <p>SOVEREIGN / DEMO &amp; READ-ONLY TESTNET STATUS</p>
        <Link href="/agreements" className="underline">Synthetic agreement examples</Link>
        <p>No audit, capital protection, or execution guarantee.</p>
      </footer>
    </div>
  );
}
