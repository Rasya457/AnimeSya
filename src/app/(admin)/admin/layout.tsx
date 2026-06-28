/**
 * Admin Layout — Server Component (Node.js runtime, BUKAN Edge).
 *
 * Arsitektur 3-lapis admin:
 *   Lapis 1: Firestore Security Rules (server Firebase, selalu aktif)
 *   Lapis 2: middleware.ts (Edge, optimistic — cek cookie ada/tidak)
 *   Lapis 3: Layout ini (Node.js — verifyIdToken + cek role dari Firestore via Admin SDK)
 *
 * Cookie "auth-storage" berisi Firebase ID token asli (JWT string),
 * di-set oleh authStore.ts via onIdTokenChanged dan auto-refresh tiap ~1 jam.
 *
 * Kalau verifikasi gagal → redirect, TIDAK render children sama sekali.
 *
 * CATATAN: proteksi di sini cuma berlaku buat RENDER halaman. Server Actions
 * (lib/admin-actions.ts) punya endpoint sendiri yang lepas dari layout ini,
 * jadi mereka re-verify admin sendiri lewat requireAdmin().
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import AdminSidebar from "@/components/admin/AdminSidebar";

export const dynamic = "force-dynamic";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Getter dipanggil di dalam component (per-request render),
  // bukan di top-level module, jadi gak ke-eksekusi pas build/page-data-collection.
  const adminAuth = getAdminAuth();
  const adminDb = getAdminDb();

  const cookieStore = await cookies();
  const raw = cookieStore.get("auth-storage")?.value;

  if (!raw) {
    redirect("/login?callbackUrl=/admin/dashboard");
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(raw);
    uid = decoded.uid;
  } catch {
    redirect("/login?callbackUrl=/admin/dashboard");
  }

  let userDoc;
  try {
    userDoc = await adminDb.collection("users").doc(uid).get();
  } catch {
    redirect("/login?callbackUrl=/admin/dashboard");
  }

  if (!userDoc.exists) {
    redirect("/login?callbackUrl=/admin/dashboard");
  }

  const userData = userDoc.data();

  if (userData?.role !== "admin") {
    redirect("/?unauthorized=1");
  }

  const adminName = userData?.name || "Admin";
  const adminEmail = userData?.email || "";

  return (
    <div className="min-h-screen bg-black flex">
      <AdminSidebar name={adminName} email={adminEmail} />

      <main className="flex-1 flex flex-col min-h-screen overflow-hidden relative">
        {/* Grid pattern halus — signature tekstur "control room" buat admin panel */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(16,185,129,1) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,1) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <header className="h-14 border-b border-emerald-900/30 flex items-center px-6 shrink-0 bg-black/60 backdrop-blur sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-500">AnimeSya</span>
            <span className="text-zinc-700">/</span>
            <span className="text-sm font-bold text-zinc-100">Admin Panel</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
              ADMIN
            </span>
            <span className="text-xs font-mono text-zinc-600 hidden sm:block">{adminEmail}</span>
          </div>
        </header>

        <div className="flex-1 p-6 md:p-8 overflow-auto relative z-[1]">{children}</div>
      </main>
    </div>
  );
}