import AgreementWorkspace from "@/components/workspace/AgreementWorkspace";

export default function CreateIntentPage() {
  return (
    <div className="space-y-unit-6">
      <section className="border-b-2 border-on-surface pb-unit-5">
        <p className="font-label-caps text-label-caps font-bold text-primary">PARTICIPANT TRANSACTION WORKSPACE</p>
        <h1 className="font-headline-lg text-headline-lg font-bold">Create Agreement</h1>
        <p className="mt-2 max-w-3xl text-secondary">Intent commitment, participant binding, canonical EIP-712 terms, CRE validation request, and exact-capital Arc approval.</p>
      </section>
      <AgreementWorkspace />
    </div>
  );
}
