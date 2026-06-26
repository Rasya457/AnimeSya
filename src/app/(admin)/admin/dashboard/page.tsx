/**
 * Admin Dashboard — Server Component.
 * Terlindungi otomatis karena nested di bawah (admin)/admin/layout.tsx
 * yang sudah verifikasi cookie + role sebelum render page ini.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Dashboard — AnimeSya",
  robots: "noindex, nofollow",
};

async function getStats() {
  try {
    const usersSnap = await adminDb.collection("users").get();
    const totalUsers = usersSnap.size;

    let totalAdmins = 0;
    usersSnap.docs.forEach((doc) => {
      if (doc.data()?.role === "admin") totalAdmins++;
    });

    // FIX: dokumen user di Firestore lu pakai field `joinedAt` (string, mis. "Jun 2026"),
    // BUKAN `createdAt`. orderBy() ke field yang gak exist bikin Firestore exclude
    // dokumen itu dari hasil query — makanya "User Terbaru" bisa kosong walau ada user.
    // Karena `joinedAt` cuma string "Mon YYYY" (gak presisi & gak bisa di-sort kronologis
    // dengan benar), sementara ini diambil tanpa orderBy dulu.
    const recentSnap = await adminDb.collection("users").limit(5).get();
    const recentUsers = recentSnap.docs.map((doc) => ({
      id: doc.id,
      name: (doc.data().name as string) ?? "—",
      email: (doc.data().email as string) ?? "—",
      role: (doc.data().role as string) === "admin" ? "admin" : "user",
      joined: (doc.data().joinedAt as string) ?? "—",
    }));

    return { totalUsers, totalAdmins, recentUsers };
  } catch {
    return { totalUsers: 0, totalAdmins: 0, recentUsers: [] };
  }
}

const ICON_PATHS: Record<string, string> = {
  users:
    "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z",
  shield:
    "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  user: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
};

function Icon({ name, className }: { name: string; className: string }): ReactNode {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_PATHS[name]} />
    </svg>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-zinc-950/60 backdrop-blur-sm rounded-xl p-6 border border-emerald-900/30 shadow-lg shadow-black/40">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-bold text-zinc-100 mt-1">{value.toLocaleString()}</p>
        </div>
        <div
          className={
            accent
              ? "w-12 h-12 bg-emerald-500/10 rounded-lg flex items-center justify-center"
              : "w-12 h-12 bg-zinc-900 rounded-lg flex items-center justify-center"
          }
        >
          <Icon name={icon} className={accent ? "w-6 h-6 text-emerald-400" : "w-6 h-6 text-zinc-400"} />
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  href,
  title,
  desc,
  icon,
}: {
  href: string;
  title: string;
  desc: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 hover:border-emerald-500/40 hover:bg-zinc-900 transition-all duration-150 group"
    >
      <Icon name={icon} className="w-5 h-5 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-500">{desc}</p>
      </div>
      <svg
        className="w-4 h-4 text-zinc-700 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export default async function AdminDashboardPage() {
  const { totalUsers, totalAdmins, recentUsers } = await getStats();

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto w-full">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
        <p className="text-sm text-zinc-500">Overview dan manajemen AnimeSya</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Users" value={totalUsers} icon="users" />
        <StatCard label="Admin Aktif" value={totalAdmins} icon="shield" accent />
        <StatCard label="Regular Users" value={totalUsers - totalAdmins} icon="user" />
      </div>

      <div className="bg-zinc-950/60 backdrop-blur-sm rounded-xl border border-emerald-900/30 p-5 flex flex-col gap-4">
        <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuickAction
            href="/admin/users"
            title="Kelola User"
            desc="Lihat daftar user, ban, hapus akun"
            icon="users"
          />
          <QuickAction
            href="/admin/roles"
            title="Role Management"
            desc="Promosi / demosi role user ke admin"
            icon="shield"
          />
        </div>
      </div>

      {recentUsers.length > 0 && (
        <div className="bg-zinc-950/60 backdrop-blur-sm rounded-xl border border-emerald-900/30 overflow-hidden">
          <div className="px-5 py-4 border-b border-emerald-900/30 flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">User Terbaru</h2>
            <Link
              href="/admin/users"
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
            >
              Lihat semua
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
          <div className="divide-y divide-emerald-900/20">
            {recentUsers.map((u) => (
              <div key={u.id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-zinc-900 border border-emerald-900/40 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-emerald-400 uppercase">{u.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-200 truncate">{u.name}</p>
                  <p className="text-xs font-mono text-zinc-500 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.role === "admin" ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      Admin
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900 border border-zinc-700 px-2 py-0.5 rounded-full">
                      User
                    </span>
                  )}
                  <span className="text-xs text-zinc-600">{u.joined}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}