"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bot,
  CheckCircle2,
  CirclePlus,
  Gavel,
  Handshake,
  History,
  LayoutDashboard,
  Menu,
  Network,
  ShieldCheck,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/agreements", label: "Agreements", icon: Gavel },
  { href: "/negotiation", label: "Negotiation", icon: Handshake },
  { href: "/monitoring", label: "Public Status", icon: BarChart3 },
  { href: "/create-intent", label: "Intent Preview", icon: CirclePlus },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/agents", label: "Agents", icon: Bot },
] satisfies Array<{ href: string; label: string; icon: LucideIcon }>;

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
        aria-expanded={isOpen}
      >
        {isOpen ? <X size={17} strokeWidth={2.5} /> : <Menu size={17} strokeWidth={2.5} />}
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
          <Link
            href="/"
            aria-label="Sovereign home"
            className="h-[74px] px-unit-4 border-b-2 border-on-surface bg-surface-container-low flex items-center pl-14 lg:pl-4"
          >
            <Image
              src="/logo.png"
              alt="Sovereign"
              width={160}
              height={67}
              priority
              className="h-auto w-40 max-w-full object-contain"
            />
          </Link>

          {/* Navigation */}
          <nav aria-label="Sovereign Protocol pages" className="p-unit-3 pt-unit-4 flex flex-col gap-unit-1">
            <p className="px-unit-3 pb-unit-2 font-label-caps text-label-caps text-secondary">WORKSPACE</p>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || (pathname === "/" && item.href === "/overview");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  aria-current={isActive ? "page" : undefined}
                  className={`group flex items-center gap-unit-3 px-unit-3 py-2.5 font-code-md text-code-md tracking-wider font-medium w-full transition-colors ${
                    isActive
                      ? "bg-on-surface text-surface-container-lowest border border-on-surface translate-x-0.5 translate-y-0.5 font-semibold"
                      : "text-on-surface border border-transparent hover:border-on-surface hover:bg-surface-container-high"
                  }`}
                  style={isActive ? { boxShadow: "2px 2px 0px #3155ff" } : undefined}
                >
                  <Icon size={17} strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                  <span className={`w-1.5 h-1.5 ${isActive ? "bg-electric-blue" : "bg-transparent group-hover:bg-electric-blue"}`} aria-hidden="true" />
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Telemetry */}
        <div className="p-unit-3 border-t-2 border-on-surface bg-surface-container-low flex flex-col gap-unit-2">
          <div className="flex items-center justify-between text-on-surface px-unit-2 py-1.5 border border-on-surface bg-surface-container-lowest font-code-sm text-code-sm"
            style={{ boxShadow: "1px 1px 0px #1b1c19" }}>
            <span className="flex items-center gap-unit-1">
              <CheckCircle2 size={14} className="text-tertiary" aria-hidden="true" />
              <span>Sepolia testnet</span>
            </span>
            <span className="font-bold">READY</span>
          </div>
          <div className="flex items-center justify-between text-on-surface px-unit-2 py-1.5 border border-on-surface bg-surface-container-lowest font-code-sm text-code-sm"
            style={{ boxShadow: "1px 1px 0px #1b1c19" }}>
            <span className="flex items-center gap-unit-1">
              <Network size={14} className="text-primary" aria-hidden="true" />
              <span>Arc testnet</span>
            </span>
            <span className="font-bold">READY</span>
          </div>
          <div className="mt-unit-1 p-unit-2.5 bg-surface-container border border-on-surface flex items-start gap-unit-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-electric-blue" aria-hidden="true" />
            <div className="font-label-caps text-label-caps text-secondary uppercase">Public status reads live contract state</div>
          </div>
        </div>
      </aside>
    </>
  );
}
