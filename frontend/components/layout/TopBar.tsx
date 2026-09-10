import WalletConnection from "@/components/ui/WalletConnection";

export default function TopBar() {
  return (
    <header className="fixed top-0 left-0 lg:left-64 right-0 h-14 bg-surface-container-low border-b-2 border-on-surface flex items-center justify-between gap-2 pl-16 pr-3 lg:px-unit-6 z-30">
      <div className="font-code-sm text-[10px] sm:text-code-sm font-bold text-on-surface">
        TESTNET / NO ATTESTATION CLAIM
      </div>
      <WalletConnection />
    </header>
  );
}
