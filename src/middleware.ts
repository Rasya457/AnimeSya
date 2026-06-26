import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─── Route yang dilindungi (butuh autentikasi) ──────────────────────────────────
// Catatan: /admin juga masuk sini untuk optimistic check (token ada/tidak).
// Verifikasi ROLE sungguhan dilakukan di Server Component layout → (admin)/admin/layout.tsx
// karena middleware berjalan di Edge Runtime yang tidak support firebase-admin SDK.
const PROTECTED_ROUTES = ["/profile", "/watchlist", "/history", "/admin"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Cek apakah route yang diminta perlu perlindungan
  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isProtected) {
    // Cookie auth-storage berisi Firebase ID token asli (set oleh authStore.ts via onIdTokenChanged).
    // Di sini kita hanya cek KEBERADAAN token (optimistic check), bukan verifikasi kriptografik —
    // verifikasi sungguhan (adminAuth.verifyIdToken) ada di (admin)/admin/layout.tsx.
    const authStorage = request.cookies.get("auth-storage");

    if (!authStorage?.value) {
      const loginUrl = new URL("/login", request.url);
      // Simpan path asal supaya setelah login user bisa diarahkan balik
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Route yang diproteksi — definisikan eksplisit supaya tidak salah match
    "/profile/:path*",
    "/watchlist/:path*",
    "/history/:path*",
    "/admin/:path*",
    // Tangkap semua route lain (kecuali static assets & Next.js internal)
    // supaya middleware tetap jalan untuk halaman publik (misal: redirect dari /login kalau sudah login)
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
