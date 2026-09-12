"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/overview", label: "Overview", icon: "dashboard" },
  { href: "/agreements", label: "Agreements", icon: "gavel" },
  { href: "/negotiation", label: "Negotiation", icon: "handshake" },
  { href: "/monitoring", label: "Public Status", icon: "analytics" },
  { href: "/create-intent", label: "Intent Preview", icon: "add_circle" },
  { href: "/activity", label: "Activity", icon: "history" },
  { href: "/agents", label: "Agents", icon: "smart_toy" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile Toggle Button */}
      <button 
        className="lg:hidden fixed top-3 left-4 z-50 w-8 h-8 flex items-center justify-center bg-surface-container-lowest border border-on-surface neo-press"
        style={{ boxShadow: "1px 1px 0px #1b1c19" }}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation menu"
      >
        <span className="material-symbols-outlined">{isOpen ? 'close' : 'menu'}</span>
      </button>

      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-on-surface/20 z-40 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside 
        aria-label="Main navigation"
        className={`fixed top-0 left-0 h-screen w-64 flex flex-col justify-between bg-surface-container-lowest border-r-2 border-on-surface z-40 transition-transform duration-300 lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ boxShadow: "2px 0px 0px #1b1c19" }}
      >
        <div className="flex flex-col">
          {/* Brand Header */}
          <div className="p-unit-4 border-b-2 border-on-surface bg-surface-container-low flex items-center gap-unit-3 pl-14 lg:pl-4">
            <div className="w-10 h-10 bg-on-surface text-surface-container-lowest flex items-center justify-center border-2 border-on-surface shrink-0"
              style={{ boxShadow: "1px 1px 0px #1b1c19" }}>
              <span className="font-code-md text-code-md font-bold text-xs">SOV</span>
            </div>
            <div>
              <div className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight">
                SOVEREIGN
              </div>
              <div className="font-label-caps text-label-caps text-secondary uppercase tracking-wider">
                Agreement Protocol
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav aria-label="Sovereign Protocol pages" className="p-unit-3 flex flex-col gap-unit-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || (pathname === "/" && item.href === "/overview");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-unit-3 px-unit-4 py-unit-3 font-code-md text-code-md tracking-wider font-medium w-full transition-none ${
                    isActive
                      ? "bg-on-surface text-surface-container-lowest border border-on-surface translate-x-0.5 translate-y-0.5 font-semibold"
                      : "text-on-surface hover:bg-surface-container-high"
                  }`}
                  style={isActive ? { boxShadow: "2px 2px 0px #3155ff" } : undefined}
                >
                  <span className="material-symbols-outlined text-lg">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Telemetry */}
        <div className="p-unit-3 border-t-2 border-on-surface bg-surface-container-low flex flex-col gap-unit-2">
          <div className="flex items-center justify-between text-on-surface px-unit-2 py-unit-1 border border-on-surface bg-surface-container-lowest font-code-sm text-code-sm"
            style={{ boxShadow: "1px 1px 0px #1b1c19" }}>
            <span className="flex items-center gap-unit-1">
              <span className="material-symbols-outlined text-tertiary text-sm">check_circle</span>
              <span>Sepolia testnet</span>
            </span>
            <span className="font-bold">READY</span>
          </div>
          <div className="flex items-center justify-between text-on-surface px-unit-2 py-unit-1 border border-on-surface bg-surface-container-lowest font-code-sm text-code-sm"
            style={{ boxShadow: "1px 1px 0px #1b1c19" }}>
            <span className="flex items-center gap-unit-1">
              <span className="material-symbols-outlined text-primary text-sm">hub</span>
              <span>Arc testnet</span>
            </span>
            <span className="font-bold">READY</span>
          </div>
          <div className="mt-unit-1 p-unit-2 bg-surface-container border border-on-surface">
            <div className="font-label-caps text-label-caps text-secondary uppercase">Public Status reads live contract state</div>
          </div>
        </div>
      </aside>
    </>
  );
}
