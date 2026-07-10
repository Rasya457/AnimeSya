"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/admin/users", label: "Kelola User", icon: "users" },
  { href: "/admin/roles", label: "Role Management", icon: "shield" },
] as const;

const ICON_PATHS: Record<string, string> = {
  grid: "M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
  users:
    "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z",
  shield:
    "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
};

function NavIcon({ name }: { name: string }): ReactNode {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_PATHS[name]} />
    </svg>
  );
}

export default function AdminSidebar({
  name,
  email,
}: {
  name?: string | null;
  email?: string | null;
}) {
  const pathname = usePathname();
  const displayName = name && name.trim().length > 0 ? name : "TES_BERHASIL_123";
  const initial = (displayName.charAt(0) || "A").toUpperCase();

  return (
    <aside className="w-60 shrink-0 border-r border-zinc-800 bg-black/40 flex flex-col">
      <div className="h-14 flex items-center gap-2 px-5 border-b border-zinc-800">
        <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
        <span className="text-sm font-bold text-zinc-100 tracking-tight">AnimeSya</span>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold bg-accent/10 text-accent border border-accent/20"
                  : "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60 border border-transparent transition-colors"
              }
            >
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-zinc-800">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/60">
          <div className="w-7 h-7 rounded-full bg-zinc-800 border border-accent/40 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-accent uppercase">{initial}</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-200 truncate">{displayName}</p>
            <p className="text-[11px] text-zinc-600 truncate">{email || ""}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}