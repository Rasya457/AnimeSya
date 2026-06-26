import { adminDb } from "@/lib/firebase-admin";
import UserTable, { type AdminUserRow } from "@/components/admin/UserTable";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kelola User — AnimeSya Admin",
  robots: "noindex, nofollow",
};

async function getUsers(): Promise<AdminUserRow[]> {
  // Gak pakai orderBy("createdAt") karena field itu gak ada di dokumen lu —
  // field yang ada namanya `joinedAt` (string "Mon YYYY", gak presisi buat di-sort).
  const snap = await adminDb.collection("users").limit(200).get();

  return snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: (data.name as string) ?? "—",
        email: (data.email as string) ?? "—",
        role: data.role === "admin" ? "admin" : "user",
        banned: Boolean(data.banned),
        joined: (data.joinedAt as string) ?? "—",
      } satisfies AdminUserRow;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default async function KelolaUserPage() {
  const users = await getUsers();
  return <UserTable initialUsers={users} />;
}