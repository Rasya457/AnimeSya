import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export class AdminGuardError extends Error {}

/**
 * PENTING: Next.js Server Action punya endpoint sendiri yang BISA dipanggil
 * langsung dari luar, lepas dari proteksi redirect di admin/layout.tsx.
 * Makanya setiap Server Action yang mengubah data (ban, hapus, ubah role)
 * WAJIB panggil requireAdmin() ini dulu — jangan andalkan layout doang.
 */
export async function requireAdmin() {
  const cookieStore = await cookies();
  const raw = cookieStore.get("auth-storage")?.value;
  if (!raw) throw new AdminGuardError("Belum login.");

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(raw);
    uid = decoded.uid;
  } catch {
    throw new AdminGuardError("Sesi login tidak valid, silakan login ulang.");
  }

  const userDoc = await adminDb.collection("users").doc(uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== "admin") {
    throw new AdminGuardError("Akun ini bukan admin.");
  }

  const data = userDoc.data() as { name?: string; email?: string; role: string };
  return { uid, ...data };
}