// lib/title-match.ts
//
// Di-extract dari logic yang udah ada di app/api/proxy/stream-indo/route.ts
// (titleSimilarity, normalizeOrdinalSeason, CROSS_SOURCE_TITLE_THRESHOLD).
//
// KENAPA DI-EXTRACT KE SINI:
// route.ts butuh fungsi ini buat matching antar-adapter pas resolve stream
// (runtime, per-request). Cron sync job butuh fungsi YANG SAMA PERSIS buat
// matching antar-source pas nulis ke Firestore (batch, background).
//
// Kalau logic-nya digandain di dua tempat, suatu saat lo tweak threshold atau
// algoritma di satu file doang, terus dua sistem itu diam-diam beda hasil
// matching-nya — bug yang susah dilacak. Jadi satu source of truth di sini.
//
// TODO (opsional, gak urgent): update import di route.ts jadi
//   import { titleSimilarity, normalizeOrdinalSeason, CROSS_SOURCE_TITLE_THRESHOLD } from '@/lib/title-match'
// dan hapus definisi lokal yang lama di sana. Gak wajib sekarang biar gak
// resiko break route.ts yang udah production-stable.

const ORDINAL_SEASON_WORDS: Record<string, string> = {
    first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
    sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
}

/** "Second Season" → "Season 2", dst — biar variasi penulisan season nyatu. */
export function normalizeOrdinalSeason(s: string): string {
    return s.replace(
        /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/gi,
        (_, word: string) => `Season ${ORDINAL_SEASON_WORDS[word.toLowerCase()]}`
    )
}

/**
 * Skor kemiripan dua judul, 0-1. Dipakai buat nentuin apakah "anime A dari
 * Otakudesu" itu anime yang sama dengan "anime B dari Samehadaku".
 *
 * - 1     → identik setelah normalisasi
 * - 0.9   → satu judul substring dari judul lain (mis. beda embel-embel subtitle)
 * - lain  → Jaccard similarity dari word overlap (kata pendek ≤2 huruf diabaikan)
 */
export function titleSimilarity(a: string, b: string): number {
    const normalize = (s: string) =>
        normalizeOrdinalSeason(s)
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    const na = normalize(a)
    const nb = normalize(b)
    if (na === nb) return 1
    if (na.includes(nb) || nb.includes(na)) return 0.9
    const wordsA = new Set(na.split(' '))
    const wordsB = new Set(nb.split(' '))
    const intersection = [...wordsA].filter(w => wordsB.has(w) && w.length > 2)
    const union = new Set([...wordsA, ...wordsB])
    return intersection.length / union.size
}

/**
 * Threshold minimum buat nganggep dua judul dari source beda itu anime yang
 * sama. Sama persis dengan yang dipakai di route.ts (findEpisodeUrlOnAdapter)
 * biar konsisten antara runtime resolve dan cron sync.
 */
export const CROSS_SOURCE_TITLE_THRESHOLD = 0.45

/** Versi "kunci lookup" — dipakai buat exact-match cepat sebelum fallback ke scoring. */
export function normalizeTitleKey(title: string): string {
    return normalizeOrdinalSeason(title)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}
