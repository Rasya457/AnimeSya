// lib/anime-matcher.ts
//
// Tugas modul ini cuma satu: nentuin apakah anime yang baru discrape dari
// suatu adapter itu udah ada di Firestore (dari source lain) atau belum,
// terus upsert dengan cara yang bener (gak bikin duplikat, gak overwrite
// data source lain).
//
// Firestore gak bisa fuzzy-query ("cari judul yang mirip X") secara native.
// Makanya strategi di sini: tarik SEMUA (id, normalizedTitle) sekali di awal
// sync run, simpan di memory sebagai index, terus scoring pakai
// titleSimilarity() di JS biasa. Ini cukup buat katalog ribuan anime;
// kalau nanti udah puluhan ribu, baru worth dipikirin pindah ke Algolia/
// Typesense buat search index-nya.

import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebase-admin' // pakai lazy-init getter yang udah ada
import { titleSimilarity, normalizeTitleKey, CROSS_SOURCE_TITLE_THRESHOLD } from '@/lib/title-match'

export interface TitleIndexEntry {
    animeId: string
    title: string
    normalizedTitle: string
}

export interface UpsertAnimeInput {
    source: string          // 'otakudesu' | 'samehadaku' | 'sokuja' | 'nontonanimeid'
    sourceSlug: string       // slug/url di source itu, buat scrape ulang nanti
    title: string
    poster?: string
    status?: 'Ongoing' | 'Completed'
    type?: string
    genres?: string[]
    synopsis?: string
}

export interface UpsertAnimeResult {
    animeId: string
    isNew: boolean
    matchedScore: number | null // null kalau anime baru (gak ada match)
}

/**
 * Tarik index ringan (cuma id + title) dari seluruh collection `animes`.
 * Panggil ini SEKALI di awal tiap cron run, jangan di dalam loop —
 * di dalam loop bakal nembak Firestore ratusan kali per sync dan boros kuota.
 */
export async function loadTitleIndex(): Promise<TitleIndexEntry[]> {
    const db = getAdminDb()
    const snap = await db.collection('animes').select('title', 'normalizedTitle').get()
    return snap.docs.map(doc => ({
        animeId: doc.id,
        title: (doc.data().title as string) ?? '',
        normalizedTitle: (doc.data().normalizedTitle as string) ?? '',
    }))
}

/**
 * Cari kandidat anime yang sama di index in-memory. Return null kalau gak
 * ada yang cukup mirip (di bawah CROSS_SOURCE_TITLE_THRESHOLD).
 */
export function findMatch(
    title: string,
    index: TitleIndexEntry[],
): { animeId: string; score: number } | null {
    const key = normalizeTitleKey(title)

    // fast path: exact match kunci normalisasi (paling sering kejadian pas
    // Otakudesu & Samehadaku kebetulan pake judul yang sama persis)
    const exact = index.find(e => e.normalizedTitle === key)
    if (exact) return { animeId: exact.animeId, score: 1 }

    // fallback: scoring manual, sama kayak findEpisodeUrlOnAdapter di route.ts
    let best: { animeId: string; score: number } | null = null
    for (const entry of index) {
        const score = titleSimilarity(title, entry.title)
        if (!best || score > best.score) best = { animeId: entry.animeId, score }
    }
    if (!best || best.score < CROSS_SOURCE_TITLE_THRESHOLD) return null
    return best
}

/**
 * Upsert satu anime hasil scrape ke Firestore.
 * - Kalau ketemu match → merge slug source baru ke doc yang udah ada
 *   (TIDAK overwrite field dari source lain).
 * - Kalau gak ketemu → bikin doc baru.
 *
 * PENTING: setelah manggil ini buat anime baru, tambahin entry-nya ke
 * `index` in-memory yang lagi lo pake di loop (push manual), biar anime yang
 * baru aja dibuat gak ke-duplicate lagi kalau muncul dari adapter berikutnya
 * di run yang sama. Lihat contoh pemakaian di app/api/cron/sync/route.ts.
 */
export async function upsertAnime(
    input: UpsertAnimeInput,
    index: TitleIndexEntry[],
): Promise<UpsertAnimeResult> {
    const db = getAdminDb()
    const match = findMatch(input.title, index)
    const now = Timestamp.now()

    if (match) {
        const ref = db.collection('animes').doc(match.animeId)
        await ref.set(
            {
                [`sources.${input.source}`]: {
                    slug: input.sourceSlug,
                    lastSyncedAt: now,
                },
                // poster/synopsis cuma diisi kalau doc lama kosong — jangan
                // overwrite data bagus dari source lain pakai data seadanya
                ...(input.poster ? { poster: input.poster } : {}),
                lastSyncedAt: now,
            },
            { merge: true },
        )
        return { animeId: match.animeId, isNew: false, matchedScore: match.score }
    }

    const newRef = db.collection('animes').doc()
    await newRef.set({
        title: input.title,
        normalizedTitle: normalizeTitleKey(input.title),
        poster: input.poster ?? '',
        status: input.status ?? 'Ongoing',
        type: input.type ?? 'TV',
        genres: input.genres ?? [],
        synopsis: input.synopsis ?? '',
        sources: {
            [input.source]: { slug: input.sourceSlug, lastSyncedAt: now },
        },
        malId: null,
        createdAt: now,
        lastSyncedAt: now,
    })
    return { animeId: newRef.id, isNew: true, matchedScore: null }
}
