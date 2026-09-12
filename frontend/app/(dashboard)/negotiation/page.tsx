import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";
import { NEGOTIATION_ROUNDS } from "@/lib/mock-data";
import AutonomousAgentRun from "@/components/agents/AutonomousAgentRun";

export default function NegotiationPage() {
  return (
    <div className="space-y-unit-8">
      {/* Context Header */}
      <section className="border-b-2 border-on-surface pb-unit-5 flex flex-col md:flex-row md:items-end justify-between gap-unit-4">
        <div>
          <div className="flex items-center gap-unit-2 mb-1">
            <span className="font-label-caps text-label-caps bg-on-surface text-surface-container-lowest px-unit-2 py-0.5">
              OVERVIEW OFFERS
            </span>
            <span className="font-label-caps text-label-caps border border-on-surface px-unit-2 py-0.5 bg-surface-container-lowest">
              NO AGENTS RUNNING
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface">
            Negotiation
          </h1>
          <p className="font-body-md text-body-md text-secondary mt-1">
            Public offer rounds. Private rationale and policy limits are never exposed.
          </p>
        </div>
        <div className="flex items-center gap-unit-3">
          <div className="border border-on-surface bg-surface-container-lowest px-unit-3 py-unit-2 neo-shadow">
            <div className="font-label-caps text-label-caps text-secondary">ROUNDS</div>
            <div className="font-code-md text-code-md font-semibold text-on-surface">04 ROUNDS</div>
          </div>
          <div className="border border-on-surface bg-surface-container-lowest px-unit-3 py-unit-2 neo-shadow">
            <div className="font-label-caps text-label-caps text-secondary">SIGNATURES</div>
            <div className="font-code-md text-code-md font-semibold text-on-surface">NOT REQUESTED</div>
          </div>
        </div>
      </section>

      <AutonomousAgentRun />

      {/* Economic Actors Bar */}
      <section className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-unit-4">
        <div className="bg-surface-container-lowest border-2 border-on-surface neo-shadow">
          <div className="bg-surface-container-high px-unit-4 py-unit-2 border-b-2 border-on-surface flex items-center justify-between">
            <span className="font-label-caps text-label-caps font-bold tracking-wider text-on-surface">PARTY A // PROPOSER</span>
            <span className="inline-flex items-center gap-1 font-label-caps text-label-caps bg-surface-container-lowest border border-on-surface px-unit-2 py-0.5">
              <span className="w-1.5 h-1.5 bg-primary-container"></span>L1_LIQUIDITY_VAULT
            </span>
          </div>
          <div className="p-unit-4 flex flex-col gap-unit-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight">TREASURY AGENT</h3>
                <div className="font-code-sm text-code-sm text-primary font-semibold">Treasury A</div>
              </div>
              <span className="font-label-caps text-label-caps border border-on-surface bg-[#FEF3C7] text-[#B45309] px-unit-2 py-1 font-semibold">
                PARTY
              </span>
            </div>
            <div className="pt-unit-2 border-t border-surface-container-high font-code-sm text-code-sm flex flex-col gap-1">
              <div className="flex justify-between"><span className="text-secondary">Authorization:</span><span className="font-semibold">NOT VERIFIED</span></div>
              <div className="flex justify-between"><span className="text-secondary">Identity:</span><span>TREASURY-A</span></div>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center px-unit-3 py-unit-2 hidden md:flex">
          <div className="w-10 h-10 bg-on-surface text-surface-container-lowest border-2 border-on-surface neo-shadow flex items-center justify-center font-headline-sm font-bold">
            VS
          </div>
          <div className="mt-unit-2 font-label-caps text-label-caps border border-on-surface bg-surface-container-lowest px-unit-2 py-0.5 neo-shadow-sm font-bold">
            SESSION NONCE #NEG-4491
          </div>
          <div className="h-6 w-px bg-on-surface mt-unit-2"></div>
        </div>
        <div className="bg-surface-container-lowest border-2 border-on-surface neo-shadow">
          <div className="bg-surface-container-high px-unit-4 py-unit-2 border-b-2 border-on-surface flex items-center justify-between">
            <span className="font-label-caps text-label-caps font-bold tracking-wider text-on-surface">PARTY B // COUNTERPARTY</span>
            <span className="inline-flex items-center gap-1 font-label-caps text-label-caps bg-surface-container-lowest border border-on-surface px-unit-2 py-0.5">
              <span className="w-1.5 h-1.5 bg-tertiary"></span>ARBITRAGE_STRAT_07
            </span>
          </div>
          <div className="p-unit-4 flex flex-col gap-unit-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight">STRATEGY AGENT</h3>
                <div className="font-code-sm text-code-sm text-primary font-semibold">Strategy A</div>
              </div>
              <span className="font-label-caps text-label-caps border border-on-surface bg-[#FEF3C7] text-[#B45309] px-unit-2 py-1 font-semibold">
                PARTY
              </span>
            </div>
            <div className="pt-unit-2 border-t border-surface-container-high font-code-sm text-code-sm flex flex-col gap-1">
              <div className="flex justify-between"><span className="text-secondary">Authorization:</span><span className="font-semibold">NOT VERIFIED</span></div>
              <div className="flex justify-between"><span className="text-secondary">Identity:</span><span>STRATEGY-A</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Timeline Feed */}
      <section className="flex flex-col gap-unit-4">
        <div className="flex items-center justify-between border-b border-on-surface pb-unit-2">
          <div className="flex items-center gap-unit-2">
            <GitBranch size={18} strokeWidth={2.25} aria-hidden="true" />
            <h2 className="font-label-caps text-label-caps font-bold uppercase tracking-wider text-on-surface">
              PUBLIC OFFER TIMELINE
            </h2>
          </div>
          <span className="font-label-caps text-label-caps text-secondary">4 ROUNDS</span>
        </div>
        <div className="flex flex-col gap-unit-4 relative">
          <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-on-surface z-0 hidden md:block"></div>
          {NEGOTIATION_ROUNDS.map((round, idx) => {
            const isLast = idx === NEGOTIATION_ROUNDS.length - 1;
            return (
              <article key={round.round} className={`relative z-10 md:ml-12 bg-surface-container-lowest border ${isLast ? "border-2 border-on-surface neo-shadow-lg" : "border-on-surface neo-shadow"}`}>
                <div className={`px-unit-4 py-unit-2 border-b ${isLast ? "border-b-2 bg-surface-container border-on-surface" : "bg-surface-container-high border-on-surface"} flex flex-wrap items-center justify-between gap-2`}>
                  <div className="flex items-center gap-unit-3">
                    <span className={`font-label-caps text-label-caps px-unit-2 py-0.5 font-bold ${isLast ? "bg-tertiary text-on-tertiary" : "bg-on-surface text-surface-container-lowest"}`}>
                      ROUND 0{round.round}
                    </span>
                    <span className="font-code-md text-code-md font-semibold text-on-surface">{round.actor}</span>
                    <span className={`font-label-caps text-label-caps border border-on-surface px-unit-2 py-0.5 font-bold ${isLast ? "bg-[#E6F4EA] text-[#00875A]" : "bg-[#ECEAE2] text-on-surface"}`}>
                      ACTION: {round.action}
                    </span>
                  </div>
                  <div className="font-code-sm text-code-sm text-secondary font-medium">TIMESTAMP: {round.timestamp}</div>
                </div>
                <div className="p-unit-4 flex flex-col gap-unit-3">
                  <div className={`grid grid-cols-1 md:grid-cols-3 gap-unit-2 p-unit-3 ${isLast ? "border-2 border-on-surface bg-[#F9F9F6]" : "border border-on-surface bg-surface-container-low"}`}>
                    <div className={isLast ? "border-l-2 border-primary pl-unit-2" : ""}>
                      <div className="font-label-caps text-label-caps text-secondary font-bold">PRINCIPAL CAPITAL</div>
                      <div className="font-num-headline text-num-headline font-bold text-on-surface">${round.capital.toLocaleString()} <span className="font-code-sm text-secondary">USDC</span></div>
                    </div>
                    <div className={isLast ? "border-l-2 border-primary pl-unit-2" : ""}>
                      <div className="font-label-caps text-label-caps text-secondary font-bold">ESCROW DURATION</div>
                      <div className="font-num-headline text-num-headline font-bold text-on-surface">{round.duration} <span className="font-code-sm text-secondary">DAYS</span></div>
                    </div>
                    <div className={isLast ? "border-l-2 border-primary pl-unit-2" : ""}>
                      <div className="font-label-caps text-label-caps text-secondary font-bold">STIPULATED YIELD</div>
                      <div className="font-num-headline text-num-headline font-bold text-primary">{round.yield.toFixed(2)}% <span className="font-code-sm text-secondary">APR</span></div>
                    </div>
                  </div>
                    <div className="bg-surface-container-lowest border border-on-surface p-unit-3">
                    <div className="font-label-caps text-label-caps text-secondary uppercase">Public terms</div>
                    <p className={`font-code-md text-code-md mt-0.5 ${isLast ? "font-semibold text-on-surface" : "text-on-surface"}`}>
                      Public offer terms. Private rationale, policy and limits are never displayed.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between border-t border-surface-container-high pt-unit-2 text-on-surface">
                    <div className="flex items-center gap-unit-2 font-code-sm text-code-sm">
                      <span className="text-secondary">OVERVIEW — NO SIGNATURE</span>
                    </div>
                    <div className="font-label-caps text-label-caps text-secondary">NO VERIFICATION CLAIM</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Convergence Banner */}
      <section className="border-2 border-on-surface bg-surface-container-lowest p-unit-6 neo-shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-unit-6">
        <div className="flex flex-col gap-unit-2">
          <div className="flex items-center gap-unit-2">
            <span className="w-3 h-3 bg-tertiary"></span>
            <span className="font-label-caps text-label-caps font-bold tracking-wider">TERMS CONVERGED</span>
          </div>
          <h3 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight">FINAL AGREEMENT TERMS (#SOV-8F29)</h3>
          <div className="flex flex-wrap items-center gap-unit-3 font-code-md text-code-md text-on-surface">
            <span className="px-unit-2 py-0.5 border border-on-surface bg-surface-container-low font-bold">$100,000 USDC</span>
            <span className="text-secondary">·</span>
            <span className="px-unit-2 py-0.5 border border-on-surface bg-surface-container-low font-bold text-primary">8.40% APR</span>
            <span className="text-secondary">·</span>
            <span className="px-unit-2 py-0.5 border border-on-surface bg-surface-container-low font-bold">25 DAYS</span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-unit-3">
          <div className="border border-dashed border-on-surface bg-surface-container-low px-unit-4 py-unit-2 flex flex-col justify-center">
            <div className="font-label-caps text-label-caps text-secondary">EXECUTION EVIDENCE</div>
            <div className="font-code-sm text-code-sm font-semibold text-on-surface">NONE</div>
          </div>
          <Link href="/agreements/SOV-8F29" className="bg-primary-container text-on-primary font-body-md text-body-md font-bold px-unit-6 py-unit-4 border-[1.5px] border-on-surface neo-shadow-blue hover:bg-primary neo-press flex items-center justify-center gap-unit-2">
            <span>VIEW AGREEMENT</span>
            <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
