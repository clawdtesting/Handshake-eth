import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "./providers";
import { Header } from "@/components/layout/header";
import { NetworkGuard } from "@/components/wallet/network-guard";
import { DealRoomAutoSignIn } from "@/components/wallet/deal-room-auto-signin";
import "./globals.css";

export const metadata: Metadata = {
  title: "Handshake: P2P NFT Trading on Ethereum",
  description:
    "Propose NFT deals wallet-to-wallet on Ethereum — no bots, no snipers. NFT-for-NFT, NFT+ETH, private offers. Atomic settlement, zero custody.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans">
        <Providers>
          <div className="relative flex min-h-screen flex-col overflow-hidden">
            <div className="pointer-events-none fixed left-[-8rem] top-24 -z-10 h-72 w-72 rounded-full bg-ethereum-purple/20 blur-3xl" />
            <div className="pointer-events-none fixed right-[-10rem] top-1/3 -z-10 h-80 w-80 rounded-full bg-fuchsia-500/10 blur-3xl" />
            <div className="pointer-events-none fixed bottom-[-10rem] left-1/3 -z-10 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl" />
            <Header />
            <NetworkGuard />
            <DealRoomAutoSignIn />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-ethereum-purple/20 bg-gradient-to-r from-ethereum-purple/10 via-fuchsia-500/5 to-cyan-400/10 py-8">
              <div className="container mx-auto flex justify-center px-4 text-sm text-foreground sm:justify-end">
                <div className="flex items-center gap-4 text-ethereum-purple">
                  <Link href="/about" className="hover:underline">
                    About
                  </Link>
                  <a
                    href="https://etherscan.io/address/"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    Contract
                  </a>
                  <a
                    href="https://x.com/Handshake_NFT"
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    X
                  </a>
                  <span className="cursor-default text-muted-foreground">
                    Discord
                  </span>
                </div>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}