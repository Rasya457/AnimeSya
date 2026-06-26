"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteUserAccount, setUserBanned } from "@/lib/admin-actions";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  banned: boolean;
  joined: string;
};

export default function UserTable({ initialUsers }: { initialUsers: AdminUserRow[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [users, query]);

  function handleToggleBan(user: AdminUserRow) {
    setError(null);
    setPendingId(user.id);
    startTransition(async () => {
      const res = await setUserBanned(user.id, !user.banned);
      if (res.ok) {
        setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, banned: !u.banned } : u)));
      } else {
        setError(res.error);
      }
      setPendingId(null);
    });
  }

  function handleDelete(user: AdminUserRow) {
    setError(null);
    setPendingId(user.id);
    startTransition(async () => {
      const res = await deleteUserAccount(user.id);
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== user.id));
      } else {
        setError(res.error);
      }
      setPendingId(null);
      setConfirmDeleteId(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-zinc-100">Kelola User</h1>
        <p className="text-sm text-zinc-500">{users.length} akun terdaftar</p>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cari nama atau email..."
        className="w-full rounded-lg bg-zinc-900 border border-emerald-900/40 px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-emerald-900/30 bg-zinc-950/60 overflow-hidden">
        <div className="hidden sm:grid grid-cols-[2fr_2fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-emerald-900/30 bg-zinc-900/40 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <span>User</span>
          <span>Email</span>
          <span>Bergabung</span>
          <span>Status</span>
          <span className="text-right">Aksi</span>
        </div>

        <div className="divide-y divide-emerald-900/20">
          {filtered.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-zinc-600">Gak ada user yang cocok.</div>
          )}

          {filtered.map((u) => {
            const rowPending = isPending && pendingId === u.id;
            return (
              <div
                key={u.id}
                className="grid grid-cols-1 sm:grid-cols-[2fr_2fr_1fr_1fr_auto] gap-2 sm:gap-4 px-5 py-3 sm:items-center"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-zinc-900 border border-emerald-900/40 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-emerald-400 uppercase">{u.name.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{u.name}</p>
                    {u.role === "admin" && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        Admin
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-xs font-mono text-zinc-500 truncate sm:block">{u.email}</p>
                <p className="text-xs text-zinc-500">{u.joined}</p>

                <div>
                  {u.banned ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                      Banned
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      Aktif
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 sm:justify-end">
                  <button
                    onClick={() => handleToggleBan(u)}
                    disabled={rowPending}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-amber-500/50 hover:text-amber-400 transition-colors disabled:opacity-40"
                  >
                    {u.banned ? "Unban" : "Ban"}
                  </button>

                  {confirmDeleteId === u.id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs px-2 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        Batal
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        disabled={rowPending}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors disabled:opacity-40"
                      >
                        {rowPending ? "..." : "Yakin?"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(u.id)}
                      disabled={rowPending}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-red-500/50 hover:text-red-400 transition-colors disabled:opacity-40"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}