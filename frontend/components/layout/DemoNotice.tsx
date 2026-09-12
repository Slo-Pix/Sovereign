export default function DemoNotice() {
  return (
    <aside aria-label="Network status" className="border-b-2 border-on-surface bg-surface-container-high px-4 py-2 text-on-surface flex flex-wrap items-center gap-x-4 gap-y-1">
      <p className="font-code-sm text-code-sm font-bold flex items-center gap-2">
        <span className="w-2 h-2 bg-primary-container border border-on-surface" aria-hidden />
        SEPOLIA + ARC TESTNET
      </p>
      <p className="text-xs text-secondary">
        Agreement state is read from the deployed contracts at each chain&apos;s finalized block. Connecting a wallet
        requests account access only; no signature or transaction is requested.
      </p>
    </aside>
  );
}