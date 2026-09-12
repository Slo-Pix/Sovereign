import Link from "next/link";
import Image from "next/image";
import WalletConnection from "@/components/ui/WalletConnection";
import canonical from "../../deployments/canonical.json";

const AGREEMENT = canonical.rehearsal.agreementId;

const lifecycle = [
  ["01", "Commit a policy", "Publish a salted commitment to your risk thresholds. The thresholds themselves never touch the chain."],
  ["02", "Negotiate terms", "Counterparties exchange EIP-712 signed offers bound to the intent, the registry and the chain."],
  ["03", "Confidential validation", "The workflow checks the signed terms against the committed policy and activates the agreement."],
  ["04", "Continuous enforcement", "Authenticated position data is evaluated on a schedule. A breach unwinds escrow across chains."],
];

const features = [
  {
    title: "Your policy stays yours",
    body: "Minimum yield, loss tolerance and duration are committed as a salted hash. Counterparties can verify you are bound to a policy without learning what it is, so they cannot price against your limits.",
  },
  {
    title: "Silence is the default",
    body: "A healthy position produces no report, no transaction and no event. This reduces routine disclosure, while timing, public observations and repeated agreements can still reveal bounded information.",
  },
  {
    title: "Decisions, not data",
    body: "The workflow reads authenticated private position data and publishes a single decision. Inputs never leave the handler, and the receiver rejects anything that is not a well-formed, correctly bound report.",
  },
  {
    title: "Enforcement across chains",
    body: "Agreements settle on Ethereum while capital sits in escrow on Arc. A breach recorded on Sepolia unwinds the escrow and returns capital, gated on finalized source evidence.",
  },
  {
    title: "Authenticated position feed",
    body: "Observations arrive over an authenticated channel with separate, agreement-scoped read and write credentials, freshness limits, quotas and revocation. Stale or mismatched data yields no decision at all.",
  },
  {
    title: "Guarded state machine",
    body: "Replay protection, decision nonces, terminal-state guards and strict caller authorization are enforced in the contracts, covered by fuzz and invariant tests, not by convention.",
  },
];

const stack = [
  ["Ethereum Sepolia", "Intent and agreement registries, decision sink, and the authenticated report receiver."],
  ["Chainlink CRE", "Confidential evaluation of a private policy against authenticated position data."],
  ["Arc testnet", "USDC escrow, locked on activation and unwound on a finalized breach."],
];

export default function LandingPage() {
  return (
    <div className="bg-surface-container-low text-on-surface min-h-screen font-body-md">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-on-surface focus:px-3 focus:py-2 focus:text-surface-container-lowest focus:font-code-sm">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b-2 border-on-surface bg-surface-container-low px-4 md:px-10 py-3 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3 font-headline-sm font-bold">
          <Image
            src="/logo.png"
            alt="Sovereign"
            width={132}
            height={55}
            priority
            className="h-auto w-32 object-contain"
          />
        </Link>
        <p className="font-code-sm text-[10px] md:text-sm font-bold flex items-center gap-2">
          <span className="w-2 h-2 bg-primary-container border border-on-surface" aria-hidden />
          LIVE ON SEPOLIA + ARC
        </p>
        <WalletConnection />
      </header>

      <main className="grid-bg" id="main-content">
        <section className="max-w-7xl mx-auto px-6 md:px-10 pt-16 pb-16 border-b-2 border-on-surface" id="overview">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 reveal-up">
              <p className="hairline-label font-code-sm uppercase tracking-widest mb-6">Private risk policy, enforced onchain</p>
              <h1 className="font-display-lg text-display-lg md:text-[58px] md:leading-[62px] font-bold tracking-tight mb-6">
                Enforce your terms.<br /><span className="underline decoration-primary-container decoration-4 underline-offset-8">Never reveal them.</span>
              </h1>
              <p className="font-body-lg text-body-lg text-secondary mb-8 max-w-xl">
                Sovereign lets a lender commit to a private risk policy, have it enforced automatically across two chains,
                and publish only the decision needed for enforcement. No thresholds onchain. SAFE monitoring stays silent.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href={`/agreements/${AGREEMENT}`} className="bg-primary-container text-on-primary border-2 border-on-surface px-6 py-3 font-code-md font-bold neo-shadow neo-press hover:bg-primary">See a live agreement</Link>
                <Link href="/overview" className="bg-surface-container-lowest border-2 border-on-surface px-6 py-3 font-code-md font-bold neo-shadow neo-press hover:bg-surface-container-high">Open the dashboard</Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 border-2 border-on-surface bg-surface-container-lowest p-4 mt-10 neo-shadow-sm">
                <div className="border-b sm:border-b-0 sm:border-r border-surface-container-highest pb-3 sm:pb-0 sm:pr-3"><p className="text-xs font-code-sm">CHAINS SETTLED ACROSS</p><p className="text-3xl font-bold">02</p></div>
                <div className="border-b sm:border-b-0 sm:border-r border-surface-container-highest py-3 sm:py-0 sm:px-3"><p className="text-xs font-code-sm">POLICY VALUES PUBLISHED</p><p className="text-3xl font-bold">00</p></div>
                <div className="pt-3 sm:pt-0 sm:pl-3"><p className="text-xs font-code-sm">CONTRACTS VERIFIED</p><p className="text-3xl font-bold">05</p></div>
              </div>
            </div>
            <div className="lg:col-span-5 border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow-lg reveal-up reveal-delay-2">
              <h2 className="font-code-md font-bold border-b-2 border-on-surface pb-3 mb-5">HOW AN AGREEMENT RUNS</h2>
              <div className="space-y-4">
                {lifecycle.map(([step, title, description]) => (
                  <div key={step} className="border border-on-surface bg-surface-container-low p-4 transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_#3155ff]">
                    <p className="font-code-sm text-primary font-bold">{step} / {title}</p>
                    <p className="text-sm text-secondary mt-2">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 md:px-10 py-16 border-b-2 border-on-surface" id="problem">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <div>
              <p className="font-code-sm text-secondary mb-2">THE PROBLEM</p>
              <h2 className="font-headline-lg text-headline-lg font-bold mb-4">Publishing your limits is publishing your hand.</h2>
              <p className="text-secondary">
                Automated enforcement normally means putting your risk parameters onchain where everyone can read them.
                Once a counterparty knows your exact loss tolerance, they know precisely how far they can push before
                anything happens to them. The safer you try to be, the more you give away.
              </p>
            </div>
            <div>
              <p className="font-code-sm text-secondary mb-2">THE APPROACH</p>
              <h2 className="font-headline-lg text-headline-lg font-bold mb-4">Commit to the rule. Publish only the ruling.</h2>
              <p className="text-secondary">
                Your policy is committed as a salted hash, so it is provably fixed but not readable. Evaluation happens
                off-chain against authenticated data, and only an actionable decision is ever written. A safe position
                produces no transaction at all, reducing observable output without guaranteeing complete threshold secrecy.
              </p>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 md:px-10 py-16 border-b-2 border-on-surface" id="features">
          <p className="font-code-sm text-secondary mb-2">CAPABILITIES</p>
          <h2 className="font-headline-lg text-headline-lg font-bold mb-8">Built for agreements that have to hold.</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <article key={feature.title} className={`border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow neo-hover transition-transform duration-200 reveal-up reveal-delay-${Math.min(index % 4, 3)}`}>
                <div className="flex items-center justify-between border-b border-surface-container-highest pb-3 mb-4">
                  <span className="font-label-caps text-label-caps text-secondary">0{index + 1}</span>
                  <span className="status-marker" aria-hidden="true" />
                </div>
                <h3 className="font-headline-sm font-bold">{feature.title}</h3>
                <p className="mt-3 text-secondary">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 md:px-10 py-16 border-b-2 border-on-surface" id="evidence">
          <p className="font-code-sm text-secondary mb-2">PROVEN ONCHAIN</p>
          <h2 className="font-headline-lg text-headline-lg font-bold mb-4">A full lifecycle, settled and verifiable.</h2>
          <p className="text-secondary max-w-3xl mb-8">
            One agreement ran the entire path on public testnets: validated and activated, breached on fresh position
            data, escrow unwound on Arc, and reconciled to a terminal state on Ethereum. Every transaction is finalized
            and independently checkable on a block explorer.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow">
              <p className="font-code-sm text-secondary">ETHEREUM SEPOLIA</p>
              <p className="font-num-display text-num-display font-bold mt-2">{canonical.rehearsal.sepolia.finalState}</p>
              <p className="text-sm text-secondary mt-2">Agreement reached a terminal state after owner reconciliation.</p>
            </div>
            <div className="border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow">
              <p className="font-code-sm text-secondary">ARC TESTNET</p>
              <p className="font-num-display text-num-display font-bold mt-2">{canonical.rehearsal.arcTestnet.finalState}</p>
              <p className="text-sm text-secondary mt-2">Escrow released and capital returned in full.</p>
            </div>
            <div className="border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow">
              <p className="font-code-sm text-secondary">DECISIONS PUBLISHED</p>
              <p className="font-num-display text-num-display font-bold mt-2">{canonical.rehearsal.sepolia.decisionNonce}</p>
              <p className="text-sm text-secondary mt-2">One validation, one breach. Safe checks published nothing.</p>
            </div>
          </div>
          <Link href={`/agreements/${AGREEMENT}`} className="inline-block mt-8 border-2 border-on-surface bg-surface-container-lowest px-6 py-3 font-code-md font-bold neo-press">
            Inspect the transactions
          </Link>
        </section>

        <section className="max-w-7xl mx-auto px-6 md:px-10 py-16 border-b-2 border-on-surface" id="architecture">
          <p className="font-code-sm text-secondary mb-2">ARCHITECTURE</p>
          <h2 className="font-headline-lg text-headline-lg font-bold mb-8">Three layers, one guarantee.</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {stack.map(([name, body]) => (
              <article key={name} className="border-2 border-on-surface bg-surface-container-lowest p-6 neo-shadow">
                <h3 className="font-headline-sm font-bold">{name}</h3>
                <p className="mt-3 text-secondary">{body}</p>
              </article>
            ))}
          </div>
          <p className="text-sm text-secondary mt-6 max-w-3xl">
            Contracts are source-verified on Etherscan. Cross-chain settlement waits for finalized source evidence
            before moving capital, and every decision is bound to a specific agreement, check kind and nonce.
          </p>
        </section>

        <section className="max-w-7xl mx-auto px-6 md:px-10 py-20">
          <div className="border-2 border-on-surface bg-surface-container-lowest p-8 md:p-12 neo-shadow-lg">
            <p className="font-code-sm text-secondary mb-3">START HERE</p>
            <h2 className="font-headline-lg text-headline-lg font-bold mb-4">Look up any agreement.</h2>
            <p className="text-secondary max-w-2xl mb-6">
              Public status reads both chains at their finalized block and returns the agreement state, chain IDs and
              block numbers. No wallet required, and no private evaluation data is ever exposed.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/monitoring" className="inline-block border-2 border-on-surface bg-primary-container text-on-primary px-6 py-3 font-code-md font-bold neo-press">Open public status</Link>
              <Link href="/agreements" className="inline-block border-2 border-on-surface bg-surface-container-lowest px-6 py-3 font-code-md font-bold neo-press">Browse agreements</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-on-surface px-6 md:px-10 py-8 flex flex-wrap justify-between gap-4 font-code-sm text-sm">
        <p>SOVEREIGN / PRIVATE POLICY ENFORCEMENT</p>
        <Link href="/agreements" className="underline">Agreements</Link>
        <p>Running on Sepolia and Arc testnets. Not audited; no capital guarantee.</p>
      </footer>
    </div>
  );
}
