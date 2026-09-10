"use client";

import { useEffect, useRef, useState } from "react";

// Local EIP-1193 surface; no wallet SDK or global Window declaration needed.
type ProviderListener = (value: unknown) => void;
type EthereumProvider = {
  request: (args: { method: "eth_requestAccounts" }) => Promise<unknown>;
  on?: (event: "accountsChanged" | "disconnect", listener: ProviderListener) => void;
  removeListener?: (event: "accountsChanged" | "disconnect", listener: ProviderListener) => void;
};

function firstAccount(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === "string" && /^0x[0-9a-fA-F]{40}$/.test(value[0])
    ? value[0]
    : null;
}

export default function WalletConnection() {
  const [account, setAccount] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const requestId = useRef(0);
  const connecting = useRef(false);

  useEffect(() => () => {
    requestId.current += 1;
    cleanup.current?.();
  }, []);

  async function connect() {
    if (connecting.current) return;
    cleanup.current?.();
    cleanup.current = null;
    const id = ++requestId.current;
    setAccount(null);
    setError(null);
    const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    if (!provider || typeof provider.request !== "function") {
      setError("No injected wallet available. Install or enable a browser wallet.");
      return;
    }

    connecting.current = true;
    setPending(true);
    const accountsChanged: ProviderListener = (accounts) => {
      requestId.current += 1;
      setAccount(firstAccount(accounts));
      setError(null);
    };
    const disconnected: ProviderListener = () => {
      requestId.current += 1;
      setAccount(null);
      setError("Wallet disconnected. Reconnect to display an account.");
    };
    try {
      if (provider.on && provider.removeListener) {
        cleanup.current = () => {
          provider.removeListener?.("accountsChanged", accountsChanged);
          provider.removeListener?.("disconnect", disconnected);
        };
        provider.on("accountsChanged", accountsChanged);
        provider.on("disconnect", disconnected);
      }
      const address = firstAccount(await provider.request({ method: "eth_requestAccounts" }));
      if (id !== requestId.current) return;
      if (!address) throw new Error("No account");
      setAccount(address);
    } catch {
      if (id === requestId.current) {
        setAccount(null);
        setError("Wallet connection unavailable or declined. Try again in your wallet.");
      }
    } finally {
      connecting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="relative font-code-sm text-code-sm">
      <button
        type="button"
        onClick={connect}
        disabled={pending}
        title={account ? `Wallet account: ${account}. No signature or transaction requested.` : "Request wallet account access only"}
        className="border-2 border-on-surface bg-on-surface text-surface-container-lowest px-3 py-2 neo-shadow disabled:opacity-50"
      >
        {pending ? "Connecting…" : account ? `Wallet: ${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}
      </button>
      <span className="sr-only" role="status">{account ? `Connected account ${account}. No signing or transactions.` : "No connected account."}</span>
      {error && (
        <p role="alert" className="absolute right-0 top-full mt-2 w-64 max-w-[75vw] border-2 border-on-surface bg-surface-container-lowest p-3 text-on-surface neo-shadow">
          {error}
        </p>
      )}
    </div>
  );
}