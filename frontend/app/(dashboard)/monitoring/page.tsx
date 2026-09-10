import PublicAgreementStatus from "@/components/monitoring/RiskSimulator";

export default function MonitoringPage() {
  return (
    <div className="space-y-unit-6">
      <section className="border-b-2 border-on-surface pb-unit-5">
        <p className="font-label-caps text-label-caps text-secondary">TESTNET / READ-ONLY PUBLIC STATUS</p>
        <h1 className="font-headline-lg text-headline-lg font-bold">Agreement Monitoring</h1>
        <p className="text-secondary mt-2">
          Enter an explicit onchain agreement ID to read Sepolia registry and Arc escrow state.
          This page does not evaluate risk, submit transactions, or provide attestations.
        </p>
      </section>
      <PublicAgreementStatus />
    </div>
  );
}

