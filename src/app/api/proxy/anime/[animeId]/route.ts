import { NextRequest, NextResponse } from 'next/server'
import type { AnimeDetail, EpisodeListItem } from '@/types/anime'

const JIKAN = 'https://api.jikan.moe/v4'

// ─── Cache ────────────────────────────────────────────────────────────────────
// Ongoing anime: 5 menit — episode baru bisa muncul kapan saja
// Completed anime: 1 jam — data sudah stabil, tidak perlu sering refetch
const REVALIDATE_ONGOING   = 300
const REVALIDATE_COMPLETED = 3600

async function safeFetch(url: string, revalidate = REVALIDATE_ONGOING, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { next: { revalidate } })
      if (res.status === 429) {
        console.warn(`[proxy-anime] Jikan 429. Retrying ${i + 1}/${retries} after ${delayMs * (i + 1)}ms...`)
        await new Promise(r => setTimeout(r, delayMs * (i + 1)))
        continue
      }
      if (!res.ok) return null
      return await res.json()
    } catch {
      if (i === retries - 1) return null
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return null
}

// ─── Helpers (sama persis dengan home proxy) ──────────────────────────────────

const BROADCAST_DAY_INDEX: Record<string, number> = {
  sundays: 0, sunday: 0,
  mondays: 1, monday: 1,
  tuesdays: 2, tuesday: 2,
  wednesdays: 3, wednesday: 3,
  thursdays: 4, thursday: 4,
  fridays: 5, friday: 5,
  saturdays: 6, saturday: 6,
}

/**
 * Estimasi episode yang sudah tayang (JST-aware).
 * Kalau hari ini = hari broadcast tapi belum jam 18:00 JST,
 * episode minggu ini dianggap belum tayang.
 */
function estimateCurrentEpisode(
  airedFrom:     string | null | undefined,
  broadcastDay:  string | null | undefined,
  totalEpisodes: number | null | undefined,
): number | null {
  if (!airedFrom) return null

  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const start  = new Date(airedFrom)
  if (isNaN(start.getTime())) return null

  const nowJST  = Date.now() + JST_OFFSET_MS
  const startMs = start.getTime()
  if (nowJST < startMs) return null

  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
  let weeksPassed   = Math.floor((nowJST - startMs) / MS_PER_WEEK)

  if (broadcastDay) {
    const bcastIdx = BROADCAST_DAY_INDEX[broadcastDay.toLowerCase().trim()]
    if (bcastIdx !== undefined) {
      const todayJST = new Date(nowJST)
      const todayIdx = todayJST.getUTCDay()
      const hourJST  = todayJST.getUTCHours()
      if (todayIdx === bcastIdx && hourJST < 18) {
        weeksPassed = Math.max(0, weeksPassed - 1)
      }
    }
  }

  const estimated = Math.max(1, weeksPassed + 1)
  return totalEpisodes ? Math.min(estimated, totalEpisodes) : estimated
}

function mapStatus(status: string): 'Ongoing' | 'Completed' {
  return status?.toLowerCase().includes('airing') ? 'Ongoing' : 'Completed'
}

function mapType(type: string): AnimeDetail['type'] {
  const valid = ['TV', 'Movie', 'OVA', 'ONA', 'Special']
  return (valid.includes(type) ? type : 'TV') as AnimeDetail['type']
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ animeId: string }> }
) {
  const { animeId } = await params

  // Fetch metadata dulu (cepat), lalu tentukan revalidate berdasarkan status
  const detailJson = await safeFetch(`${JIKAN}/anime/${animeId}`, REVALIDATE_ONGOING)

  if (!detailJson?.data) {
    return NextResponse.json(
      { statusCode: 404, statusMessage: 'Not Found', data: null, pagination: null },
      { status: 404 }
    )
  }

  const a          = detailJson.data
  const isOngoing  = mapStatus(a.status ?? '') === 'Ongoing'
  const epRevalid  = isOngoing ? REVALIDATE_ONGOING : REVALIDATE_COMPLETED

  const episodesJson = await safeFetch(`${JIKAN}/anime/${animeId}/episodes`, epRevalid)

  // ── Episode list dari Jikan ───────────────────────────────────────────────
  const broadcastDay   = a.broadcast?.day ?? null
  const currentEpisode = isOngoing
    ? estimateCurrentEpisode(a.aired?.from, broadcastDay, a.episodes)
    : null

  const jikanEpisodes: EpisodeListItem[] = Array.isArray(episodesJson?.data)
    ? episodesJson.data.map((ep: any) => ({
        slug:          String(ep.mal_id),
        title:         ep.title ?? `Episode ${ep.mal_id}`,
        episodeNumber: ep.mal_id,
        uploadDate:    ep.aired ?? undefined,
      }))
    : []

  // ── Isi gap episode yang belum di-index Jikan ─────────────────────────────
  // Jikan sering telat 1–2 episode untuk anime yang sedang tayang.
  // Karena stream pakai Megaplay (malId + epNum), kita generate placeholder
  // untuk episode yang hilang supaya user bisa langsung klik dan nonton.
  const maxListed = jikanEpisodes.reduce((m, e) => Math.max(m, e.episodeNumber ?? 0), 0)
  const gapTarget = currentEpisode ?? maxListed

  const generatedEpisodes: EpisodeListItem[] =
    gapTarget > maxListed
      ? Array.from({ length: gapTarget - maxListed }, (_, i) => ({
          slug:          `gen-ep-${maxListed + i + 1}`,
          title:         `Episode ${maxListed + i + 1}`,
          episodeNumber: maxListed + i + 1,
          uploadDate:    undefined,
        }))
      : []

  const episodes = [...jikanEpisodes, ...generatedEpisodes]

  // ── Build response ────────────────────────────────────────────────────────
  const anime: AnimeDetail & { currentEpisode?: number } = {
    slug:             String(a.mal_id),
    title:            a.title ?? '',
    alternativeTitle: a.title_english ?? undefined,
    poster:           a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
    score:            a.score ?? 0,
    status:           mapStatus(a.status ?? ''),
    type:             mapType(a.type ?? 'TV'),
    totalEpisodes:    a.episodes ?? '?',
    aired:            a.aired?.string ?? '',
    studio:           a.studios?.[0]?.name ?? 'Unknown',
    genres:           (a.genres ?? []).map((g: any) => ({
                        slug: g.name.toLowerCase().replace(/\s+/g, '-'),
                        name: g.name,
                      })),
    synopsis:         a.synopsis ?? '',
    episodes,
    // Field tambahan — dipakai DetailClient untuk validasi displayEpisodes
    ...(currentEpisode != null && { currentEpisode }),
  }

  return NextResponse.json({
    statusCode:    200,
    statusMessage: 'OK',
    data:          anime,
    pagination:    null,
  })
}