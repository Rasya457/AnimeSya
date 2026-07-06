// app/api/cron/sync/route.ts
//
// Alur:
// 1. Ambil master list "ongoing" dari Otakudesu (source utama, paling stabil).
// 2. Load title index dari Firestore sekali (buat matching, bukan per-anime).
// 3. Tiap anime di master list:
//    a. Upsert base doc (source: otakudesu).
//    b. Cross-check ke Sokuja/NontonAnimeID/Samehadaku via endpoint
//       `adapter-search` (lihat route-additions.ts) — kalau skor kemiripan
//       judul >= threshold, ambil juga episode list & stream dari situ,
//       merge ke doc yang sama (bukan bikin anime baru).
//    c. Simpan episode terbaru ke collection `episodes`, streams per-source
//       biar gak saling menimpa.
//
// PENTING soal reliability: kalau salah satu source lagi down, loop TETAP
// LANJUT ke anime/source berikutnya (try/catch per-item). Satu source mati
// gak boleh bikin seluruh sync gagal — itu justru poin utama caching ini.

import { NextRequest, NextResponse } from 'next/server'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebase-admin'
import { loadTitleIndex, upsertAnime, findMatch, type TitleIndexEntry } from '@/lib/anime-matcher'
import { titleSimilarity, CROSS_SOURCE_TITLE_THRESHOLD } from '@/lib/title-match'

// ⚠️ Samain persis sama MIRRORS[0] yang dipakai di route.ts biar reconstruct
// URL detail-nya nyambung (endpoint=ongoing cuma balikin slug, bukan full URL)
const OTAKUDESU_BASE = process.env.OTAKUDESU_BASE ?? 'https://otakudesu.cloud'
const PROXY_BASE = process.env.PROXY_BASE_URL ?? 'https://your-app.vercel.app/api/proxy/stream-indo'

const SECONDARY_SOURCES = ['nontonanimeid', 'sokuja', 'samehadaku'] as const

interface OngoingItem {
    animeId: string
    title: string
    poster: string
    episodes: string
}

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    return res.json()
}

export async function GET(req: NextRequest) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const db = getAdminDb()
    const summary = {
        otakudesuSynced: 0,
        secondarySourcesMatched: 0,
        episodesSynced: 0,
        failed: 0,
        errors: [] as string[],
    }

    // ── 1. Master list dari Otakudesu ──
    let ongoingList: OngoingItem[] = []
    try {
        const { data } = await fetchJson<{ data: { animeList: OngoingItem[] } }>(
            `${PROXY_BASE}?endpoint=ongoing&page=1`,
        )
        ongoingList = data.animeList
    } catch (e) {
        // Kalau bahkan Otakudesu (source utama) down, gak ada yang bisa
        // di-sync sama sekali run ini — return error tapi jangan throw
        // (biar Vercel Cron gak retry-loop terus-terusan sia-sia).
        return NextResponse.json(
            { error: `Master list Otakudesu gagal diambil: ${(e as Error).message}` },
            { status: 502 },
        )
    }

    // ── 2. Title index, sekali doang buat seluruh run ──
    const titleIndex: TitleIndexEntry[] = await loadTitleIndex()

    for (const item of ongoingList) {
        try {
            const animeUrl = `${OTAKUDESU_BASE}/anime/${item.animeId}/`

            // (a) upsert base anime dari Otakudesu
            const upserted = await upsertAnime(
                {
                    source: 'otakudesu',
                    sourceSlug: item.animeId,
                    title: item.title,
                    poster: item.poster,
                    status: 'Ongoing',
                },
                titleIndex,
            )
            if (upserted.isNew) {
                // Anime baru → masukin ke index in-memory biar anime lain
                // yang sama dari source berikutnya di run ini gak dianggap "baru" lagi
                titleIndex.push({
                    animeId: upserted.animeId,
                    title: item.title,
                    normalizedTitle: item.title.toLowerCase(),
                })
            }
            summary.otakudesuSynced++

            const latestEpisodeNum = parseInt(item.episodes, 10)
            const episodeSourcesFound: Record<string, unknown> = {}

            // Otakudesu punya endpoint episodes generic (bukan lewat adapter-episodes)
            try {
                const { data: epList } = await fetchJson<{ data: { url: string; episode: number }[] }>(
                    `${PROXY_BASE}?endpoint=episodes&url=${encodeURIComponent(animeUrl)}`,
                )
                const latestEp = epList.find(e => e.episode === latestEpisodeNum) ?? epList[0]
                if (latestEp) {
                    const { data: stream } = await fetchJson<{ data: unknown }>(
                        `${PROXY_BASE}?endpoint=stream&url=${encodeURIComponent(latestEp.url)}`,
                    )
                    episodeSourcesFound.otakudesu = stream
                }
            } catch {
                // gagal ambil stream Otakudesu buat anime ini → skip, lanjut ke source lain
            }

            // (b) cross-check ke source sekunder
            for (const source of SECONDARY_SOURCES) {
                try {
                    const { data: hits } = await fetchJson<{ data: { title: string; url: string }[] }>(
                        `${PROXY_BASE}?endpoint=adapter-search&source=${source}&q=${encodeURIComponent(item.title)}`,
                    )
                    if (!hits.length) continue

                    let best: { url: string; title: string; score: number } | null = null
                    for (const h of hits) {
                        const score = titleSimilarity(item.title, h.title)
                        if (!best || score > best.score) best = { ...h, score }
                    }
                    if (!best || best.score < CROSS_SOURCE_TITLE_THRESHOLD) continue

                    // Match ketemu → merge slug ke doc yang sama (BUKAN doc baru)
                    await upsertAnime(
                        { source, sourceSlug: best.url, title: item.title },
                        titleIndex,
                    )
                    summary.secondarySourcesMatched++

                    // Ambil episode terbaru dari source ini juga
                    const { data: epList } = await fetchJson<{ data: { url: string; episode: number }[] }>(
                        `${PROXY_BASE}?endpoint=adapter-episodes&source=${source}&url=${encodeURIComponent(best.url)}`,
                    )
                    const latestEp = epList.find(e => e.episode === latestEpisodeNum) ?? epList[epList.length - 1]
                    if (latestEp) {
                        const { data: stream } = await fetchJson<{ data: unknown }>(
                            `${PROXY_BASE}?endpoint=adapter-stream&source=${source}&url=${encodeURIComponent(latestEp.url)}`,
                        )
                        episodeSourcesFound[source] = stream
                    }
                } catch (e) {
                    // satu source sekunder gagal (down/selector berubah) → jangan
                    // stop, lanjut ke source berikutnya buat anime yang sama
                    summary.errors.push(`[${source}] ${item.title}: ${(e as Error).message}`)
                }
            }

            // (c) tulis episode doc — merge per-source, gak saling overwrite
            if (Object.keys(episodeSourcesFound).length > 0 && !isNaN(latestEpisodeNum)) {
                const episodeId = `${upserted.animeId}_ep${latestEpisodeNum}`
                const updates: Record<string, unknown> = { updatedAt: Timestamp.now(), animeId: upserted.animeId, episodeNumber: latestEpisodeNum }
                for (const [source, stream] of Object.entries(episodeSourcesFound)) {
                    updates[`streamsBySource.${source}`] = stream
                }
                await db.collection('episodes').doc(episodeId).set(updates, { merge: true })
                summary.episodesSynced++
            }
        } catch (e) {
            summary.failed++
            summary.errors.push(`${item.title}: ${(e as Error).message}`)
        }
    }

    return NextResponse.json({ success: summary.failed === 0, ...summary, timestamp: new Date().toISOString() })
}
