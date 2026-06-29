import type { AnimeDetail, AnimeListItem, EpisodeListItem, RelatedAnime } from '@/types/anime'

const JIKAN = 'https://api.jikan.moe/v4'
const WAJIK = 'https://wajik-anime-api.vercel.app/otakudesu'

// ─── Cache TTL ────────────────────────────────────────────────────────────────
const REVALIDATE_ONGOING = 300   // 5 menit — episode baru bisa muncul sewaktu-waktu
const REVALIDATE_COMPLETED = 3600  // 1 jam   — data sudah stabil

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapStatus(status: string): 'Ongoing' | 'Completed' {
  return status?.toLowerCase().includes('airing') ? 'Ongoing' : 'Completed'
}

function mapType(type: string): AnimeDetail['type'] {
  const valid = ['TV', 'Movie', 'OVA', 'ONA', 'Special']
  return (valid.includes(type) ? type : 'TV') as AnimeDetail['type']
}

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
  airedFrom: string | null | undefined,
  broadcastDay: string | null | undefined,
  totalEpisodes: number | null | undefined,
): number | null {
  if (!airedFrom) return null
  const JST = 9 * 60 * 60 * 1000
  const start = new Date(airedFrom)
  if (isNaN(start.getTime())) return null
  const nowJST = Date.now() + JST
  if (nowJST < start.getTime()) return null

  let weeksPassed = Math.floor((nowJST - start.getTime()) / (7 * 24 * 60 * 60 * 1000))

  if (broadcastDay) {
    const bcastIdx = BROADCAST_DAY_INDEX[broadcastDay.toLowerCase().trim()]
    if (bcastIdx !== undefined) {
      const d = new Date(nowJST)
      if (d.getUTCDay() === bcastIdx && d.getUTCHours() < 18) {
        weeksPassed = Math.max(0, weeksPassed - 1)
      }
    }
  }

  const estimated = Math.max(1, weeksPassed + 1)
  return totalEpisodes ? Math.min(estimated, totalEpisodes) : estimated
}

/**
 * Safe fetch wrapper that handles Jikan rate limiting (429) and auto-retries.
 */
async function safeFetchJikan(url: string, revalidate = 300, retries = 3, delayMs = 1000): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { next: { revalidate } })
      if (res.status === 429) {
        console.warn(`[anime-api] Jikan 429. Retrying ${i + 1}/${retries} after ${delayMs * (i + 1)}ms...`)
        await new Promise(r => setTimeout(r, delayMs * (i + 1)))
        continue
      }
      if (!res.ok) {
        console.error(`[anime-api] Fetch failed ${url} → ${res.status}`)
        return null
      }
      return await res.json()
    } catch (e) {
      console.error(`[anime-api] Error fetching ${url} (attempt ${i + 1}/${retries}):`, e)
      if (i === retries - 1) return null
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return null
}

function daysSinceLastBroadcast(dayOfWeek: string | null | undefined): number {
  if (!dayOfWeek) return 999
  const broadcastDay = BROADCAST_DAY_INDEX[dayOfWeek.toLowerCase().trim()]
  if (broadcastDay === undefined) return 999

  // Anime broadcast dalam JST — offset UTC+9
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const nowJST = new Date(Date.now() + JST_OFFSET_MS)
  const todayIndex = nowJST.getUTCDay()           // 0–6 dalam JST

  return (todayIndex - broadcastDay + 7) % 7          // 0 = paling baru
}

function mapJikanListItem(a: any): AnimeListItem {
  const broadcastDay = a.broadcast?.day ?? null
  const currentEpisode = estimateCurrentEpisode(a.aired?.from, broadcastDay, a.episodes)

  return {
    animeId: String(a.mal_id),
    title: a.title ?? a.title_english ?? '',
    poster: a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
    episodes: a.episodes ?? '?',
    releaseDay: broadcastDay?.toLowerCase() ?? '-',
    latestReleaseDate: a.aired?.string ?? '',
    genres: (a.genres ?? []).map((g: any) => g.name),
    score: a.score ?? null,
    status: a.status?.includes('Airing') ? 'Ongoing' : 'Completed',
    ...({
      daysSinceUpdate: daysSinceLastBroadcast(broadcastDay),
      currentEpisode: currentEpisode !== null ? currentEpisode : undefined,
    } as any),
  }
}


// ─── Resolve otakudesu slug → MAL ID ─────────────────────────────────────────
async function resolveToMalId(animeId: string): Promise<string> {
  if (!isNaN(Number(animeId))) return animeId

  const wajikRes = await fetch(`${WAJIK}/anime/${animeId}`, { next: { revalidate: 3600 } })
  if (!wajikRes.ok) throw new Error(`[resolveToMalId] wajik fetch failed: ${wajikRes.status}`)

  const wajikJson = await wajikRes.json()
  const title = wajikJson?.data?.title as string | undefined
  if (!title) throw new Error(`[resolveToMalId] no title for slug: ${animeId}`)

  const searchRes = await fetch(
    `${JIKAN}/anime?q=${encodeURIComponent(title)}&limit=1&sfw=true`,
    { next: { revalidate: 3600 } }
  )
  if (!searchRes.ok) throw new Error(`[resolveToMalId] jikan search failed: ${searchRes.status}`)

  const searchJson = await searchRes.json()
  const malId = searchJson?.data?.[0]?.mal_id
  if (!malId) throw new Error(`[resolveToMalId] no MAL ID found for: "${title}"`)

  return String(malId)
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const animeApi = {
  // ─── Detail ───────────────────────────────────────────────────────────────
  detail: async (animeId: string): Promise<AnimeDetail & { currentEpisode?: number }> => {
    const malId = await resolveToMalId(animeId)

    // Fetch metadata dulu untuk tahu status ongoing/completed
    const detailRes = await fetch(`${JIKAN}/anime/${malId}`, {
      next: { revalidate: REVALIDATE_ONGOING },
    })
    if (!detailRes.ok) throw new Error(`Jikan anime ${malId}: ${detailRes.status}`)

    const detailJson = await detailRes.json()
    const a = detailJson.data
    const isOngoing = mapStatus(a.status ?? '') === 'Ongoing'
    const epTTL = isOngoing ? REVALIDATE_ONGOING : REVALIDATE_COMPLETED

    const episodesRes = await fetch(`${JIKAN}/anime/${malId}/episodes`, {
      next: { revalidate: epTTL },
    })
    const episodesJson = episodesRes.ok ? await episodesRes.json() : null

    // ── Hitung episode terkini ─────────────────────────────────────────────
    const broadcastDay = a.broadcast?.day ?? null   // ⚠️ bukan day_of_week
    const currentEpisode = isOngoing
      ? estimateCurrentEpisode(a.aired?.from, broadcastDay, a.episodes)
      : null

    // ── Episode dari Jikan ─────────────────────────────────────────────────
    const jikanEps: EpisodeListItem[] = Array.isArray(episodesJson?.data)
      ? episodesJson.data.map((ep: any) => ({
        slug: String(ep.mal_id),
        title: ep.title ?? `Episode ${ep.mal_id}`,
        episodeNumber: ep.mal_id,
        uploadDate: ep.aired ?? undefined,
      }))
      : []

    // ── Isi gap episode yang belum di-index Jikan ──────────────────────────
    // Jikan sering telat 1–2 episode untuk anime yang sedang tayang.
    // Placeholder cukup — Megaplay hanya butuh malId + epNum untuk stream.
    const maxListed = jikanEps.reduce((m, e) => Math.max(m, e.episodeNumber ?? 0), 0)
    const gapTarget = currentEpisode ?? maxListed
    const fillerEps: EpisodeListItem[] = gapTarget > maxListed
      ? Array.from({ length: gapTarget - maxListed }, (_, i) => ({
        slug: `gen-ep-${maxListed + i + 1}`,
        title: `Episode ${maxListed + i + 1}`,
        episodeNumber: maxListed + i + 1,
        uploadDate: undefined,
      }))
      : []

    const episodes = [...jikanEps, ...fillerEps]

    // ── Fetch relations ──────────────────────────────────────────────────────
    // Fetch relations and details in parallel batches to avoid sequential
    // rate-limit delays. Use jitter to spread requests.
    let relatedAnime: RelatedAnime[] = []
    try {
      const relationsRes = await fetch(`${JIKAN}/anime/${malId}/relations`, {
        next: { revalidate: REVALIDATE_COMPLETED },
      })
      const relationsJson = relationsRes.ok ? await relationsRes.json() : null

      if (relationsJson && Array.isArray(relationsJson.data)) {
        const animeEntries: { mal_id: number; name: string; relation: string }[] = []
        for (const rel of relationsJson.data) {
          if (rel.relation === 'Adaptation') continue
          for (const ent of (rel.entry ?? [])) {
            if (ent.type === 'anime') {
              animeEntries.push({ mal_id: ent.mal_id, name: ent.name, relation: rel.relation })
            }
          }
        }

        // Limit to 9 entries, fetch in batches of 3 with 400ms between batches
        const targetEntries = animeEntries.slice(0, 9)
        const BATCH_SIZE = 3
        for (let i = 0; i < targetEntries.length; i += BATCH_SIZE) {
          if (i > 0) await new Promise(r => setTimeout(r, 400))
          const batch = targetEntries.slice(i, i + BATCH_SIZE)
          const results = await Promise.allSettled(
            batch.map(entry =>
              fetch(`${JIKAN}/anime/${entry.mal_id}`, {
                next: { revalidate: REVALIDATE_COMPLETED },
              }).then(async res => {
                if (!res.ok) return { entry, d: null }
                const j = await res.json()
                return { entry, d: j.data ?? null }
              }).catch(() => ({ entry, d: null }))
            )
          )
          for (const r of results) {
            if (r.status !== 'fulfilled') continue
            const { entry, d } = r.value
            const posterUrl = d?.images?.jpg?.large_image_url ?? d?.images?.jpg?.image_url
            relatedAnime.push({
              malId: String(entry.mal_id),
              title: d?.title ?? entry.name,
              relation: entry.relation,
              // Use undefined (not '') so the "No Poster" fallback renders
              poster: posterUrl || undefined,
              score: d?.score ?? undefined,
              type: d?.type ?? undefined,
              status: d?.status ? mapStatus(d.status) : undefined,
            })
          }
        }
      }
    } catch (err) {
      console.warn('[anime-api] Failed to fetch relations:', err)
    }

    return {
      slug: malId,
      title: a.title ?? '',
      alternativeTitle: a.title_english ?? undefined,
      poster: a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
      score: a.score ?? 0,
      status: mapStatus(a.status ?? ''),
      type: mapType(a.type ?? 'TV'),
      totalEpisodes: a.episodes ?? '?',
      aired: a.aired?.string ?? '',
      studio: a.studios?.[0]?.name ?? 'Unknown',
      genres: (a.genres ?? []).map((g: any) => ({
        slug: g.name.toLowerCase().replace(/\s+/g, '-'),
        name: g.name,
      })),
      synopsis: a.synopsis ?? '',
      episodes,
      relations: relatedAnime,
      ...(currentEpisode != null && { currentEpisode }),
    }
  },

  // ─── Search ───────────────────────────────────────────────────────────────
  search: async (q: string): Promise<AnimeListItem[]> => {
    const res = await fetch(
      `${JIKAN}/anime?q=${encodeURIComponent(q)}&limit=20`,
      { cache: 'no-store' }
    )
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json?.data)
      ? json.data.map((a: any) => ({
        animeId: String(a.mal_id),
        title: a.title ?? '',
        poster: a.images?.jpg?.large_image_url ?? '',
        episodes: a.episodes ?? '?',
        releaseDay: a.broadcast?.day?.toLowerCase() ?? '-',  // ⚠️ bukan day_of_week
        latestReleaseDate: a.aired?.string ?? '',
        genres: (a.genres ?? []).map((g: any) => g.name),
        score: a.score ?? null,
        status: a.status?.includes('Airing') ? 'Ongoing' : 'Completed',
      }))
      : []
  },

  home: async (page = '1'): Promise<{ ongoing: AnimeListItem[]; completed: AnimeListItem[] }> => {
    const [ongoingJson, completedJson] = await Promise.all([
      safeFetchJikan(`${JIKAN}/seasons/now?page=${page}`, REVALIDATE_ONGOING),
      safeFetchJikan(`${JIKAN}/top/anime?filter=bypopularity&page=${page}`, REVALIDATE_COMPLETED),
    ])

    const ongoing = (Array.isArray(ongoingJson?.data) ? ongoingJson.data.map(mapJikanListItem) : [])
      .sort((a: any, b: any) => a.daysSinceUpdate - b.daysSinceUpdate)

    const completed = Array.isArray(completedJson?.data)
      ? completedJson.data.map(mapJikanListItem)
      : []

    const dedup = (list: AnimeListItem[]) => {
      const seen = new Set<string>()
      return list.filter(item => {
        if (seen.has(item.animeId)) return false
        seen.add(item.animeId)
        return true
      })
    }

    return { ongoing: dedup(ongoing), completed: dedup(completed) }
  },
}