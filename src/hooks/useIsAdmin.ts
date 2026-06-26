import { useAuthStore } from "@/store/authStore";

/**
 * Hook buat cek apakah user yang login punya role admin.
 * `isLoading` true selama auth state belum kebentuk (misal pas refresh page,
 * sebelum onAuthStateChanged & onSnapshot profil sempat jalan) — guna mencegah
 * flash konten admin sebelum role-nya kebaca beneran dari Firestore.
 */
export function useIsAdmin() {
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const isLoading = isAuthenticated && user === null;
  const isAdmin = user?.role === "admin";

  return { isAdmin, isLoading };
}