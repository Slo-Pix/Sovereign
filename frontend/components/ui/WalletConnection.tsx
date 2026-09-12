"use client";

import { useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

const privyConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function MissingPrivyConfiguration() {
  return (
    <div className="relative font-code-sm text-code-sm">
      <button
        type="button"
        disabled
        title="Configure NEXT_PUBLIC_PRIVY_APP_ID to enable wallet connection"
        className="border-2 border-on-surface bg-on-surface text-surface-container-lowest px-3 py-2 neo-shadow disabled:opacity-50"
      >
        Wallet unavailable
      </button>
      <p role="alert" className="absolute right-0 top-full mt-2 w-72 max-w-[80vw] border-2 border-on-surface bg-surface-container-lowest p-3 text-on-surface neo-shadow">
        Privy wallet connection is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID and restart the frontend.
      </p>
    </div>
  );
}

function PrivyWalletConnection() {
  const { ready, authenticated, connectWallet, logout, error: privyError } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const [error, setError] = useState<string | null>(null);
  const account = wallets[0]?.address ?? null;
  const pending = !ready || !walletsReady;

  async function connect() {
    if (pending) return;
    setError(null);

    try {
      if (authenticated && account) {
        await logout();
        return;
      }

      connectWallet();
    } catch {
      setError("Wallet connection unavailable or declined. Try again in Privy.");
    }
  }

  const displayedError = error || privyError?.message || null;
  const label = pending ? "Loading wallet" : account ? `Wallet: ${shortAddress(account)}` : "Connect wallet";

  return (
    <div className="relative font-code-sm text-code-sm">
      <button
        type="button"
        onClick={connect}
        disabled={pending}
        title={account ? `Wallet account: ${account}. No signature or transaction requested.` : "Connect through Privy; no signature or transaction requested"}
        className="border-2 border-on-surface bg-on-surface text-surface-container-lowest px-3 py-2 neo-shadow disabled:opacity-50"
      >
        {label}
      </button>
      <span className="sr-only" role="status">
        {account ? `Connected account ${account}. No signing or transactions.` : "No connected account."}
      </span>
      {displayedError && (
        <p role="alert" className="absolute right-0 top-full mt-2 w-72 max-w-[80vw] border-2 border-on-surface bg-surface-container-lowest p-3 text-on-surface neo-shadow">
          Wallet connection unavailable. Check Privy configuration and try again.
        </p>
      )}
    </div>
  );
}

export default function WalletConnection() {
  return privyConfigured ? <PrivyWalletConnection /> : <MissingPrivyConfiguration />;
}
