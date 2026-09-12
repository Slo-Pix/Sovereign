import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Sovereign",
  description:
    "Private risk policies, enforced onchain across Ethereum and Arc without publishing the policy.",
  icons: {
    icon: "/logo_part.png",
    shortcut: "/logo_part.png",
    apple: "/logo_part.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-surface-container-low text-on-surface antialiased min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
