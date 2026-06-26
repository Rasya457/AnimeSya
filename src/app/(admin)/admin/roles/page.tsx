import { cookies } from "next/headers";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import RoleManager, { type RoleRow } from "@/components/admin/RoleManager";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Role Management — AnimeSya Admin",
  robots: "noindex, nofollow",
};

async function getRoleData(): Promise<{ rows: RoleRow[]; currentUid: string }> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("auth-storage")!.value;
  const decoded = await adminAuth.verifyIdToken(raw);

  const snap = await adminDb.collection("users").get();
  const rows = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: (data.name as string) ?? "—",
        email: (data.email as string) ?? "—",
        role: data.role === "admin" ? "admin" : "user",
      } satisfies RoleRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows, currentUid: decoded.uid };
}

export default async function RoleManagementPage() {
  const { rows, currentUid } = await getRoleData();
  return <RoleManager initialRows={rows} currentUid={currentUid} />;
}