"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function Providers({ children }: { children: React.ReactNode }) {
  if (!privyAppId) return children;

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          accentColor: "#3155ff",
          loginMessage: "Connect a wallet to display your account.",
          showWalletLoginFirst: true,
          theme: "light",
        },
        embeddedWallets: {
          // The autonomous demo needs two independent signers: the user's
          // external Treasury wallet and a gasless embedded Strategy wallet.
          ethereum: { createOnLogin: "all-users" },
        },
        loginMethods: ["wallet"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
