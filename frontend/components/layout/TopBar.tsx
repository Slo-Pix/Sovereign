import WalletConnection from "@/components/ui/WalletConnection";
import { Activity } from "lucide-react";

export default function TopBar() {
  return (
    <header className="fixed top-0 left-0 lg:left-64 right-0 min-h-14 bg-surface-container-low border-b-2 border-on-surface flex items-center justify-between gap-3 pl-16 pr-3 lg:px-unit-6 py-2 z-30">
      <div className="flex items-center gap-3 min-w-0">
        <div className="font-code-sm text-[10px] sm:text-code-sm font-bold text-on-surface truncate">
          TESTNET / SEPOLIA + ARC
        </div>
        <span className="hidden md:inline-flex items-center gap-1.5 border border-on-surface bg-surface-container-lowest px-2 py-1 font-label-caps text-label-caps text-secondary">
          <Activity size={12} strokeWidth={2.5} className="text-electric-blue" aria-hidden="true" />
          FINALIZED READS
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <WalletConnection />
      </div>
    </header>
  );
}
