"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Handshake } from "lucide-react";
import { OfferAlerts } from "@/components/layout/offer-alerts";
import { cn } from "@/lib/utils";

const links = [
  { href: "/market", label: "Market" },
  { href: "/create", label: "Deal" },
  { href: "/wanted", label: "Wanted" },
  { href: "/burnt", label: "Burnt" },
  { href: "/combat", label: "Combat" },
  { href: "/account", label: "Dashboard" },
  { href: "/about", label: "About" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-ethereum-purple/20 bg-background/70 shadow-lg shadow-ethereum-purple/5 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ethereum-purple text-ethereum-black">
              <Handshake className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Hand<span className="text-ethereum-purple">shake</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm transition-colors",
                  (pathname === link.href ||
                    (link.href !== "/" && pathname.startsWith(link.href)))
                    ? "bg-ethereum-purple/15 text-ethereum-purple"
                    : "text-muted-foreground hover:bg-ethereum-purple/10 hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <OfferAlerts />
          <ConnectButton
            showBalance={{ smallScreen: false, largeScreen: true }}
            chainStatus="icon"
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
          />
        </div>
      </div>
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-ethereum-purple/20 px-4 py-2 md:hidden">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
              (pathname === link.href ||
                (link.href !== "/" && pathname.startsWith(link.href)))
                ? "bg-ethereum-purple/15 text-ethereum-purple"
                : "text-muted-foreground"
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}