"use client";

import { useMemo, useState, useTransition } from "react";
import { setUserRole } from "@/lib/admin-actions";

export type RoleRow = { id: string; name: string; email: string; role: "admin" | "user" };

export default function RoleManager({
  initialRows,
  currentUid,
}: {
  initialRows: RoleRow[];
  currentUid: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  }, [rows, query]);

  const adminCount = rows.filter((r) => r.role === "admin").length;

  function handleToggleRole(row: RoleRow) {
    const nextRole = row.role === "admin" ? "user" : "admin";
    setError(null);
    setPendingId(row.id);
    startTransition(async () => {
      const res = await setUserRole(row.id, nextRole);
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, role: nextRole } : r)));
      } else {
        setError(res.error);
      }
      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-zinc-100">Role Management</h1>
        <p className="text-sm text-zinc-500">
          {adminCount} admin aktif dari {rows.length} akun
        </p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cari nama atau email..."
        className="w-full rounded-lg bg-zinc-900 border border-zinc-800/80 px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/30 transition-colors"
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 divide-y divide-zinc-800/40 overflow-hidden">
        {filtered.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-zinc-600">Gak ada user yang cocok.</div>
        )}

        {filtered.map((row) => {
          const rowPending = isPending && pendingId === row.id;
          const isSelf = row.id === currentUid;
          const selfIsLastAdmin = isSelf && row.role === "admin";

          return (
            <div key={row.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800/60 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-accent uppercase">{row.name.charAt(0)}</span>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">
                  {row.name} {isSelf && <span className="text-zinc-600 text-xs">(lu)</span>}
                </p>
                <p className="text-xs font-mono text-zinc-500 truncate">{row.email}</p>
              </div>

              <span
                className={
                  row.role === "admin"
                    ? "text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full"
                    : "text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded-full"
                }
              >
                {row.role === "admin" ? "Admin" : "User"}
              </span>

              <button
                onClick={() => handleToggleRole(row)}
                disabled={rowPending || selfIsLastAdmin}
                title={selfIsLastAdmin ? "Gak bisa demote diri sendiri" : undefined}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {rowPending ? "..." : row.role === "admin" ? "Demote" : "Jadikan Admin"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}