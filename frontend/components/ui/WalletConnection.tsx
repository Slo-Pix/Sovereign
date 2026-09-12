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
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const wallet = wallets[0];
  const account = wallet?.address ?? null;
  const connected = !disconnected && (Boolean(wallet) || authenticated);
  const pending = !ready || !walletsReady || disconnecting;

  async function connect() {
    if (pending) return;
    setError(null);

    try {
      if (connected) {
        setDisconnecting(true);

        if (authenticated) {
          await logout();
        }

        wallet?.disconnect();
        setDisconnected(true);
        return;
      }

      setDisconnected(false);
      connectWallet();
    } catch {
      setError(
        connected
          ? "Wallet disconnect failed. Try again."
          : "Wallet connection unavailable or declined. Try again in Privy.",
      );
    } finally {
      setDisconnecting(false);
    }
  }

  const displayedError = error || privyError?.message || null;
  const label = disconnecting
    ? "Disconnecting…"
    : !ready || !walletsReady
      ? "Loading wallet"
      : connected
        ? account
          ? `Disconnect: ${shortAddress(account)}`
          : "Disconnect wallet"
        : "Connect wallet";

  return (
    <div className="relative font-code-sm text-code-sm">
      <button
        type="button"
        onClick={connect}
        disabled={pending}
        aria-busy={disconnecting}
        title={
          connected
            ? account
              ? `Disconnect wallet ${account}`
              : "Disconnect Privy wallet session"
            : "Connect through Privy; no signature or transaction requested"
        }
        className="border-2 border-on-surface bg-on-surface text-surface-container-lowest px-3 py-2 neo-shadow disabled:opacity-50"
      >
        {label}
      </button>
      <span className="sr-only" role="status">
        {disconnecting
          ? "Disconnecting wallet."
          : account
            ? `Connected account ${account}. No signing or transactions.`
            : connected
              ? "Wallet session connected."
              : "No connected account."}
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
