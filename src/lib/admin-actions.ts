"use server";

import { revalidatePath } from "next/cache";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { requireAdmin, AdminGuardError } from "@/lib/admin-guard";

type ActionResult = { ok: true } | { ok: false; error: string };

function toErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AdminGuardError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export async function setUserRole(
  targetUid: string,
  nextRole: "admin" | "user"
): Promise<ActionResult> {
  try {
    const caller = await requireAdmin();

    if (nextRole === "user" && caller.uid === targetUid) {
      return { ok: false, error: "Gak bisa demote diri sendiri." };
    }

    if (nextRole === "user") {
      const adminsSnap = await adminDb.collection("users").where("role", "==", "admin").get();
      if (adminsSnap.size <= 1) {
        return { ok: false, error: "Minimal harus ada 1 admin tersisa." };
      }
    }

    await adminDb.collection("users").doc(targetUid).update({ role: nextRole });
    revalidatePath("/admin/roles");
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err, "Gagal update role.") };
  }
}

export async function setUserBanned(targetUid: string, banned: boolean): Promise<ActionResult> {
  try {
    const caller = await requireAdmin();

    if (caller.uid === targetUid) {
      return { ok: false, error: "Gak bisa ban diri sendiri." };
    }

    // Disable login di Firebase Auth + tandai di Firestore buat ditampilin di UI
    await adminAuth.updateUser(targetUid, { disabled: banned });
    await adminDb.collection("users").doc(targetUid).update({ banned });

    revalidatePath("/admin/users");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err, "Gagal update status user.") };
  }
}

export async function deleteUserAccount(targetUid: string): Promise<ActionResult> {
  try {
    const caller = await requireAdmin();

    if (caller.uid === targetUid) {
      return { ok: false, error: "Gak bisa hapus akun sendiri." };
    }

    // Hapus dari Firebase Auth dulu, lanjut bersihin dokumen Firestore-nya.
    // Kalau akun Auth-nya udah gak ada (race condition), tetep lanjut hapus Firestore.
    await adminAuth.deleteUser(targetUid).catch(() => null);
    await adminDb.collection("users").doc(targetUid).delete();

    revalidatePath("/admin/users");
    revalidatePath("/admin/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err, "Gagal hapus akun.") };
  }
}