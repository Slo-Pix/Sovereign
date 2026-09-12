import { ShieldCheck } from "lucide-react";

export default function DemoNotice() {
  return (
    <aside aria-label="Network status" className="signal-line border-b-2 border-on-surface bg-surface-container-high px-4 py-2 text-on-surface flex flex-wrap items-center gap-x-4 gap-y-1">
      <p className="font-code-sm text-code-sm font-bold flex items-center gap-2">
        <span className="status-marker" aria-hidden />
        SEPOLIA + ARC TESTNET
      </p>
      <span className="hidden md:inline-flex items-center gap-1 font-label-caps text-label-caps text-tertiary">
        <ShieldCheck size={13} strokeWidth={2.5} aria-hidden="true" />
        PUBLIC STATE
      </span>
      <p className="text-xs text-secondary">
        Agreement state is read from the deployed contracts at each chain&apos;s finalized block. Connecting a wallet
        requests account access only; no signature or transaction is requested.
      </p>
    </aside>
  );
}
