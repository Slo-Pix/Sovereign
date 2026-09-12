import Link from "next/link";
import { ArrowRight, Bot, LockKeyhole, Plus, TrendingUp, History } from "lucide-react";
import { AUDIT_LOG } from "@/lib/mock-data";

export default function OverviewPage() {
  return (
    <div className="space-y-unit-6">
      {/* Page Header */}
      <section className="border-b-2 border-on-surface pb-unit-5 flex flex-col md:flex-row md:items-end justify-between gap-unit-4">
        <div>
          <div className="flex items-center gap-unit-2 mb-unit-1">
            <span className="font-label-caps text-label-caps bg-on-surface text-surface-container-lowest px-unit-2 py-0.5 tracking-widest">
              OVERVIEW
            </span>
            <span className="font-label-caps text-label-caps border border-on-surface px-unit-2 py-0.5 tracking-widest bg-surface-container-lowest">
              SEPOLIA
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface">
            Control Plane Overview
          </h1>
          <p className="font-body-md text-body-md text-secondary mt-0.5 max-w-2xl">
            Public terms and portfolio metrics across active agreements.
            Private policy values and risk evaluations are never displayed.
          </p>
        </div>
        <div className="flex items-center gap-unit-4">
          <Link
            href="/create-intent"
            className="px-unit-6 py-unit-3 bg-primary-container text-on-primary font-code-md text-code-md uppercase font-bold border-2 border-on-surface flex items-center justify-center gap-unit-2 neo-press hover:bg-primary"
            style={{ boxShadow: "2px 2px 0px #1b1c19" }}
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
            NEW INTENT
          </Link>
        </div>
      </section>

      {/* Hero Telemetry Matrix */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-unit-4">
        <div className="bg-surface-container-lowest border border-on-surface p-unit-5 neo-shadow flex flex-col gap-unit-1">
          <div className="font-label-caps text-label-caps text-secondary uppercase tracking-widest font-bold">
            Total Principal
          </div>
          <div className="font-num-display text-num-display font-bold text-on-surface tracking-tighter">
            $100,000<span className="text-secondary text-2xl">.00</span>
          </div>
          <div className="font-code-sm text-code-sm text-secondary uppercase mt-unit-2 flex items-center gap-1">
            <LockKeyhole size={14} strokeWidth={2.5} aria-hidden="true" />
            1 ACTIVE
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-on-surface p-unit-5 neo-shadow flex flex-col gap-unit-1">
          <div className="font-label-caps text-label-caps text-secondary uppercase tracking-widest font-bold">
            Agreed Yield
          </div>
          <div className="font-num-display text-num-display font-bold text-tertiary tracking-tighter">
            8.40%
          </div>
          <div className="font-code-sm text-code-sm text-secondary uppercase mt-unit-2 flex items-center gap-1">
            <TrendingUp size={14} strokeWidth={2.5} className="text-tertiary" aria-hidden="true" />
            AGREED APR
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-on-surface p-unit-5 neo-shadow flex flex-col gap-unit-1">
          <div className="font-label-caps text-label-caps text-secondary uppercase tracking-widest font-bold">
            Coverage
          </div>
          <div className="font-num-display text-num-display font-bold text-on-surface tracking-tighter">
            100%
          </div>
          <div className="font-code-sm text-code-sm text-secondary uppercase mt-unit-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
            PORTFOLIO
          </div>
        </div>
        <div className="bg-surface-container-lowest border border-on-surface p-unit-5 neo-shadow flex flex-col gap-unit-1">
          <div className="font-label-caps text-label-caps text-secondary uppercase tracking-widest font-bold">
            Agents
          </div>
          <div className="font-num-display text-num-display font-bold text-on-surface tracking-tighter">
            02 <span className="text-secondary text-2xl">/ 02</span>
          </div>
          <div className="font-code-sm text-code-sm text-secondary uppercase mt-unit-2 flex items-center gap-1">
            <Bot size={14} strokeWidth={2.5} aria-hidden="true" />
            NEGOTIATING
          </div>
        </div>
      </section>

      {/* Featured Active Agreement */}
      <section className="bg-surface-container-lowest border-2 border-on-surface neo-shadow-lg flex flex-col lg:flex-row lg:items-stretch relative overflow-hidden">
        <div className="absolute top-4 right-4 z-10 hidden lg:block">
          <span className="px-unit-3 py-1 bg-surface-container border border-on-surface font-label-caps text-label-caps font-bold">
            SEPOLIA + ARC
          </span>
        </div>
        <div className="lg:w-1/3 border-b lg:border-b-0 lg:border-r-2 border-on-surface bg-[#F9F9F6] p-unit-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-unit-3 mb-unit-3">
              <span className="font-label-caps text-label-caps bg-on-surface text-surface-container-lowest px-unit-2 py-0.5 tracking-wider font-bold">
                ACTIVE
              </span>
              <span className="font-code-md text-code-md text-secondary tracking-widest font-semibold">
                #SOV-8F29
              </span>
            </div>
            <h2 className="font-headline-md text-headline-md font-bold text-on-surface mb-unit-1">
              $100,000 USDC
            </h2>
            <div className="font-code-md text-code-md text-secondary">
              Yield Strategy
            </div>
          </div>
          <div className="mt-unit-6 pt-unit-4 border-t border-surface-container-highest space-y-unit-3">
            <div className="flex justify-between font-code-sm text-code-sm border-b border-surface-container-highest pb-unit-2">
              <span className="text-secondary uppercase">Counterparty Agent</span>
              <span className="font-bold text-primary">Strategy A</span>
            </div>
            <div className="flex justify-between font-code-sm text-code-sm border-b border-surface-container-highest pb-unit-2">
              <span className="text-secondary uppercase">Agreed Yield Rate</span>
              <span className="font-bold text-tertiary">8.40% FIXED APR</span>
            </div>
            <div className="flex justify-between font-code-sm text-code-sm pb-unit-1">
              <span className="text-secondary uppercase">Release Date</span>
              <span className="font-bold">May 14, 2025</span>
            </div>
          </div>
          <Link
            href="/agreements/SOV-8F29"
            className="mt-unit-6 px-unit-4 py-unit-3 w-full bg-surface-container-lowest text-on-surface border-2 border-on-surface font-code-md text-code-md uppercase font-bold text-center neo-press hover:bg-surface-container flex items-center justify-center gap-2 shadow-[2px_2px_0px_#1b1c19]"
          >
            VIEW TERMS <ArrowRight size={15} strokeWidth={2.5} aria-hidden="true" />
          </Link>
        </div>
        <div className="lg:w-2/3 p-unit-6 flex flex-col justify-between">
          <div>
            <h3 className="font-label-caps text-label-caps uppercase text-secondary font-bold tracking-widest mb-unit-4">
              AGREEMENT LIFECYCLE
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-unit-2">
              <div className="border border-on-surface bg-surface-container p-unit-2 opacity-60">
                <div className="font-code-sm text-code-sm font-bold">01 INTENT</div>
              </div>
              <div className="border border-on-surface bg-surface-container p-unit-2 opacity-60">
                <div className="font-code-sm text-code-sm font-bold">02 NEGOTIATION</div>
              </div>
              <div className="border border-on-surface bg-surface-container p-unit-2 opacity-60">
                <div className="font-code-sm text-code-sm font-bold">03 VALIDATION</div>
              </div>
              <div className="border border-on-surface bg-surface-container p-unit-2 opacity-60">
                <div className="font-code-sm text-code-sm font-bold">04 ESCROW</div>
              </div>
              <div
                className="border-2 border-on-surface bg-on-surface text-surface-container-lowest p-unit-2 relative transform -translate-y-1"
                style={{ boxShadow: "3px 3px 0px #3155ff" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-code-sm text-code-sm font-bold text-primary-fixed">05 ACTIVE</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary-fixed animate-ping"></span>
                </div>
                <div className="text-[10px] text-surface-dim font-medium uppercase tracking-wider">
                  Current state
                </div>
              </div>
            </div>
          </div>
          <div className="mt-unit-6">
            <h3 className="font-label-caps text-label-caps uppercase text-secondary font-bold tracking-widest mb-unit-3">
              RECENT ACTIVITY
            </h3>
            <div className="flex flex-col gap-unit-2">
              {AUDIT_LOG.slice(0, 2).map((log, i) => (
                <div
                  key={i}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-unit-3 border border-on-surface bg-surface-container-low"
                >
                  <div className="flex items-center gap-unit-3">
                    <History size={16} strokeWidth={2} className="text-secondary" aria-hidden="true" />
                    <span className="font-code-sm text-code-sm font-medium">{log.action}</span>
                  </div>
                  <div className="flex items-center gap-unit-3">
                    <span className="font-code-sm text-code-sm text-secondary">{log.time}</span>
                    <span className="px-2 py-0.5 bg-surface-container-lowest border border-on-surface font-label-caps text-label-caps font-bold">
                      {log.network}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
