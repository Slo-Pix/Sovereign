export default function DemoNotice() {
  return (
    <aside aria-label="Data provenance" className="border-b-2 border-on-surface bg-surface-container-high px-4 py-3 text-on-surface">
      <p className="font-code-sm text-code-sm font-bold">DEMO / SYNTHETIC — NO TRANSACTIONS OR ATTESTATIONS</p>
      <p className="text-xs mt-1">
        Fixture metrics, identities, terms and activity are illustrative, not wallet balances or execution receipts.
        Only Monitoring can show explicitly requested public RPC reads, labeled LIVE_RPC_READS after success.
        Wallet connection grants no protocol authorization and requests no signature or transaction.
      </p>
    </aside>
  );
}