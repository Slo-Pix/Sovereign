import Link from "next/link";
import { AGENTS } from "@/lib/mock-data";

export default function AgentsPage() {
  return (
    <div className="space-y-unit-6">
      {/* Header & Metrics */}
      <section className="flex flex-col md:flex-row md:items-end justify-between border-b-2 border-on-surface pb-unit-5 gap-unit-4">
        <div>
          <div className="flex items-center gap-unit-2 mb-unit-1">
            <span className="font-label-caps text-label-caps bg-on-surface text-surface-container-lowest px-unit-2 py-0.5 tracking-widest font-bold">
              OVERVIEW ACTORS
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg font-bold text-on-surface tracking-tight">
            Agents Directory
          </h1>
          <p className="font-body-md text-body-md text-secondary mt-1">
            Negotiating agents and their public capacity. No private strategy or policy is exposed.
          </p>
        </div>
        <div className="flex items-center gap-unit-3">
          <div className="border border-on-surface bg-surface-container-lowest px-unit-4 py-unit-2 flex flex-col items-center justify-center neo-shadow">
            <div className="font-label-caps text-label-caps text-secondary font-bold">CAPITAL DEPLOYED</div>
            <div className="font-code-md text-code-md font-bold text-on-surface">$1,420,000.00</div>
          </div>
          <div className="border border-on-surface bg-surface-container-lowest px-unit-4 py-unit-2 flex flex-col items-center justify-center neo-shadow">
            <div className="font-label-caps text-label-caps text-secondary font-bold">DATA SOURCE</div>
            <div className="font-code-md text-code-md font-bold text-primary">PUBLIC RECORD</div>
          </div>
        </div>
      </section>

      {/* Agents Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-unit-6">
        {AGENTS.map((agent) => (
          <div key={agent.id} className="bg-surface-container-lowest border-2 border-on-surface neo-shadow-lg flex flex-col">
            {/* Agent Header */}
            <div className="bg-surface-container-high border-b-2 border-on-surface p-unit-6 flex flex-col gap-unit-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-unit-4">
                  <div className="w-16 h-16 bg-on-surface text-surface-container-lowest border-2 border-on-surface flex items-center justify-center font-headline-lg font-bold neo-shadow-sm">
                    {agent.id}
                  </div>
                  <div>
                    <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight">
                      {agent.name}
                    </h2>
                    <div className="font-code-sm text-code-sm text-primary font-semibold mt-0.5">
                      {agent.ens}
                    </div>
                  </div>
                </div>
                <span className="font-label-caps text-label-caps font-bold px-unit-2 py-1 bg-[#E6F4EA] text-[#00875A] border border-on-surface">
                  {agent.status}
                </span>
              </div>
              <div className="bg-surface-container-lowest border border-on-surface p-unit-2 px-unit-3 flex items-center justify-between">
                <span className="font-label-caps text-label-caps text-secondary uppercase font-bold">IDENTITY</span>
                <span className="font-code-sm text-code-sm font-bold break-all text-on-surface">{agent.address}</span>
              </div>
            </div>

            {/* Agent Body Data */}
            <div className="p-unit-6 grid grid-cols-1 md:grid-cols-2 gap-unit-6 flex-1">
              {/* Operational Mandate */}
              <div className="flex flex-col gap-unit-4">
                <h3 className="font-label-caps text-label-caps uppercase font-bold text-secondary tracking-widest border-b border-surface-container-highest pb-unit-2">
                  ROLE
                </h3>
                <div className="space-y-unit-3">
                  <div>
                    <div className="font-label-caps text-label-caps text-secondary">PRIMARY ROLE</div>
                    <div className="font-code-sm text-code-sm font-bold text-on-surface mt-0.5">{agent.role}</div>
                  </div>
                  <div>
                    <div className="font-label-caps text-label-caps text-secondary">DELEGATION</div>
                    <div className="font-code-sm text-code-sm font-bold text-on-surface mt-0.5">{agent.delegationContract}</div>
                  </div>
                  <div>
                    <div className="font-label-caps text-label-caps text-secondary">CAPACITY</div>
                    <div className="font-code-sm text-code-sm font-bold text-on-surface mt-0.5">{agent.executionCapacity}</div>
                  </div>
                </div>
              </div>

              {/* Cryptographic Footprint */}
              <div className="flex flex-col gap-unit-4">
                <h3 className="font-label-caps text-label-caps uppercase font-bold text-secondary tracking-widest border-b border-surface-container-highest pb-unit-2">
                  NO CRYPTOGRAPHIC EVIDENCE
                </h3>
                <div className="space-y-unit-3">
                  <div>
                    <div className="font-label-caps text-label-caps text-secondary">HARDWARE ENVIRONMENT</div>
                    <div className="font-code-sm text-code-sm font-bold text-on-surface mt-0.5 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">memory</span>
                      {agent.hardwareKey}
                    </div>
                  </div>
                  <div>
                    <div className="font-label-caps text-label-caps text-secondary">SIGNATURE SCHEME</div>
                    <div className="font-code-sm text-code-sm font-bold text-on-surface mt-0.5">{agent.sigScheme}</div>
                  </div>
                  <div>
                    <div className="font-label-caps text-label-caps text-secondary">ACTIVE AGREEMENT</div>
                    <div className="font-code-sm text-code-sm font-bold text-primary mt-0.5 hover:underline">
                      <Link href={`/agreements/${agent.activeAgreement.split(' ')[0].replace('#', '')}`}>
                        {agent.activeAgreement}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Agent Footer Action */}
            <div className="bg-surface-container-low border-t-2 border-on-surface p-unit-4 flex items-center justify-between">
              <span className="font-code-sm text-code-sm text-secondary">No heartbeat or agent connection.</span>
              <Link href="/activity" className="px-unit-4 py-unit-2 bg-surface-container-lowest text-on-surface font-code-md text-code-md font-bold uppercase border-2 border-on-surface neo-shadow-sm neo-press hover:bg-surface-container">
                View Activity
              </Link>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
