import { auth } from './firebase'

/**
 * Menghasilkan localStorage key yang unik per user.
 * - User login  → "watch-history-{uid}"
 * - Guest       → "watch-history-guest"
 *
 * Semua file yang baca/tulis history HARUS pakai helper ini
 * agar setiap akun punya history terpisah.
 */
export function getHistoryKey(userId?: string | null): string {
  if (userId) return `watch-history-${userId}`

  // Cek langsung ke Firebase Auth SDK instan (sinkron) jika di browser
  if (typeof window !== 'undefined') {
    try {
      const sdkUid = auth?.currentUser?.uid
      if (sdkUid) return `watch-history-${sdkUid}`
    } catch { /* silent */ }
  }

  return 'watch-history-guest'
}