import { NextRequest, NextResponse } from 'next/server'

const JIKAN = 'https://api.jikan.moe/v4'

async function safeFetch(url: string, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { next: { revalidate: 300 } })
      if (res.status === 429) {
        console.warn(`[proxy-home] Jikan 429. Retrying ${i + 1}/${retries} after ${delayMs * (i + 1)}ms...`)
        await new Promise(r => setTimeout(r, delayMs * (i + 1)))
        continue
      }
      if (!res.ok) {
        console.error(`[proxy-home] ${url} → ${res.status}`)
        return null
      }
      return await res.json()
    } catch (e) {
      console.error(`[proxy-home] ${url} → ERROR (attempt ${i + 1}/${retries}):`, e)
      if (i === retries - 1) return null
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Jikan mengembalikan "Mondays", "Tuesdays", dst → map ke getDay() index (0=Sun)
const BROADCAST_DAY_INDEX: Record<string, number> = {
  sundays: 0,   sunday: 0,
  mondays: 1,   monday: 1,
  tuesdays: 2,  tuesday: 2,
  wednesdays: 3, wednesday: 3,
  thursdays: 4, thursday: 4,
  fridays: 5,   friday: 5,
  saturdays: 6, saturday: 6,
}

/**
 * Berapa hari yang lalu episode terakhir tayang, dihitung dari hari ini.
 *   0  → tayang hari ini
 *   1  → tayang kemarin
 *   6  → tayang 6 hari lalu
 *   999 → hari tidak diketahui (sort ke belakang)
 *
 * PENTING: Jikan mengembalikan hari broadcast dalam JST (UTC+9).
 * Harus pakai JST juga saat membandingkan — bukan UTC server.
 * Contoh: 22:00 WIB Minggu = 15:00 UTC = 00:00 JST Senin.
 * Kalau pakai UTC, anime yang broadcast Senin dianggap masih 6 hari lagi.
 */
function daysSinceLastBroadcast(dayOfWeek: string | null | undefined): number {
  if (!dayOfWeek) return 999
  const broadcastDay = BROADCAST_DAY_INDEX[dayOfWeek.toLowerCase().trim()]
  if (broadcastDay === undefined) return 999

  // Anime broadcast dalam JST — offset UTC+9
  const JST_OFFSET_MS  = 9 * 60 * 60 * 1000
  const nowJST         = new Date(Date.now() + JST_OFFSET_MS)
  const todayIndex     = nowJST.getUTCDay()           // 0–6 dalam JST

  return (todayIndex - broadcastDay + 7) % 7          // 0 = paling baru
}

/**
 * Estimasi episode yang sudah tayang berdasarkan tanggal mulai tayang.
 * Asumsi standar: 1 episode per minggu.
 * Hasil di-clamp antara [1, totalEpisodes] jika total diketahui.
 *
 * Menggunakan JST (UTC+9) agar konsisten dengan hari broadcast Jikan.
 * Jika broadcastDay diberikan, episode hanya dihitung naik setelah
 * hari itu lewat pada minggu tersebut (mencegah +1 sebelum episode tayang).
 */
function estimateCurrentEpisode(
  airedFrom: string | null | undefined,
  broadcastDay: string | null | undefined,
  totalEpisodes: number | null | undefined,
): number | '?' {
  if (!airedFrom) return '?'

  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const start = new Date(airedFrom)
  if (isNaN(start.getTime())) return '?'

  const nowJST   = Date.now() + JST_OFFSET_MS
  const startMs  = start.getTime()
  if (nowJST < startMs) return '?'          // belum mulai tayang

  const MS_PER_WEEK  = 7 * 24 * 60 * 60 * 1000
  let   weeksPassed  = Math.floor((nowJST - startMs) / MS_PER_WEEK)

  // Kalau hari ini = hari broadcast, cek apakah episode minggu ini
  // sudah "lewat" (asumsi tayang malam JST). Kalau belum, kurangi 1.
  if (broadcastDay) {
    const bcastIdx  = BROADCAST_DAY_INDEX[broadcastDay.toLowerCase().trim()]
    if (bcastIdx !== undefined) {
      const todayJST  = new Date(nowJST)
      const todayIdx  = todayJST.getUTCDay()
      const hourJST   = todayJST.getUTCHours()
      // Anime Jepang umumnya tayang malam (>= 18:00 JST).
      // Jika hari ini = hari broadcast tapi belum jam 18:00 JST,
      // anggap episode minggu ini belum tayang.
      if (todayIdx === bcastIdx && hourJST < 18) {
        weeksPassed = Math.max(0, weeksPassed - 1)
      }
    }
  }

  const estimated = Math.max(1, weeksPassed + 1)
  return totalEpisodes ? Math.min(estimated, totalEpisodes) : estimated
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function mapJikan(a: any) {
  // ⚠️  Field Jikan v4 adalah "day", bukan "day_of_week"
  const broadcastDay   = a.broadcast?.day ?? null
  const currentEpisode = estimateCurrentEpisode(a.aired?.from, broadcastDay, a.episodes)

  return {
    animeId:           String(a.mal_id),
    title:             a.title ?? a.title_english ?? '',
    poster:            a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
    episodes:          a.episodes ?? '?',          // total episode (null = belum diketahui)
    currentEpisode,                                // estimasi episode yang sudah tayang
    // Dinormalisasi ke lowercase di sini — client pakai untuk display saja, bukan re-parse
    releaseDay:        broadcastDay?.toLowerCase() ?? '-',
    latestReleaseDate: a.aired?.string ?? '',
    genres:            (a.genres ?? []).map((g: any) => g.name),
    score:             a.score ?? null,
    status:            a.status ?? '',
    // SOURCE OF TRUTH — client JANGAN re-derive dari releaseDay, langsung pakai field ini
    daysSinceUpdate:   daysSinceLastBroadcast(broadcastDay),
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const page = searchParams.get('page') ?? '1'

  const [ongoingJson, completedJson] = await Promise.all([
    safeFetch(`${JIKAN}/seasons/now?page=${page}`),
    safeFetch(`${JIKAN}/top/anime?filter=bypopularity&page=${page}`),
  ])

  // Sort ongoing: daysSinceUpdate terkecil (paling baru update) → duluan
  const ongoing = (Array.isArray(ongoingJson?.data) ? ongoingJson.data.map(mapJikan) : [])
    .sort((a: any, b: any) => a.daysSinceUpdate - b.daysSinceUpdate)

  const completed = Array.isArray(completedJson?.data)
    ? completedJson.data.map(mapJikan)
    : []

  return NextResponse.json({
    success: true,
    data: { ongoing, completed, latestEpisode: [] },
    pagination: {
      current:  ongoingJson?.pagination?.current_page       ?? 1,
      last:     ongoingJson?.pagination?.last_visible_page  ?? 1,
      hasNext:  ongoingJson?.pagination?.has_next_page      ?? false,
    },
  })
}