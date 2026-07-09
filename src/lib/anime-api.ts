import type { AnimeDetail, AnimeListItem, EpisodeListItem, RelatedAnime } from '@/types/anime'
import * as cheerio from 'cheerio'

const JIKAN = 'https://api.jikan.moe/v4'
const WAJIK = 'https://wajik-anime-api.vercel.app/otakudesu'

// fetch() di server-side butuh URL absolut — relative path tidak valid
//
// ⚠️ process.env.VERCEL_URL SELALU nunjuk ke URL unik deployment yang lagi
// jalan (yang ada hash-nya, mis. anime-d71v0378i-....vercel.app), BUKAN
// domain production stabil. Kalau Vercel Authentication / Deployment
// Protection nyala, URL itu balikin halaman login (HTML) buat request tanpa
// auth — termasuk request server-to-server dari fungsi ini sendiri, bukan
// cuma browser. Makanya NEXT_PUBLIC_SITE_URL WAJIB di-set di Vercel env vars
// ke domain production/custom lu (tanpa hash) supaya dicek duluan dan
// VERCEL_URL gak kepake buat internal fetch ini.
function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

// Header bypass buat Deployment Protection — jaga-jaga kalau NEXT_PUBLIC_SITE_URL
// belum sempat di-set atau kita lagi manggil deployment preview yang emang
// diproteksi. Aktifin "Protection Bypass for Automation" di Vercel dashboard
// (Settings → Deployment Protection), copy secret-nya, simpan sebagai
// VERCEL_AUTOMATION_BYPASS_SECRET di env vars. Kalau env var-nya gak di-set,
// helper ini balikin object kosong dan gak ngaruh apa-apa (aman di-skip).
function internalFetchHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  return secret ? { 'x-vercel-protection-bypass': secret } : {}
}

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

// Tipe entry yang bukan tontonan cerita beneran (video promosi, insert song,
// commercial, dst). Dibuang dari section Seasons & Hubungan Anime meskipun
// relation-nya "Sequel"/"Side Story" di data Jikan — cuma ketauan tipenya
// SETELAH detail-nya di-fetch, jadi filter ini dipasang di titik itu, bukan
// pas masih mentah dari /relations.
const NON_STORY_TYPES = new Set(['music', 'pv', 'cm'])

// Kategori relation yang dianggap "core franchise" — season lanjutan/awal
// (Sequel, Prequel) dan movie/side content yang emang nempel langsung ke
// cerita utama (Side Story, Alternative Version/Setting, Parent Story,
// Full Story). SENGAJA gak masukin Summary (compilation/recap film),
// Spin-off, Character, Other, Adaptation — kategori-kategori itu yang
// bikin section-nya "tambah banyak" isinya kompilasi/game-tie-in/cameo
// yang gak relevan buat orang nyari season lanjutan.
const CORE_RELATIONS = new Set([
  'sequel', 'prequel', 'side story',
  'alternative version', 'alternative setting',
  'parent story', 'full story',
])

// Dari kategori di atas, cuma Sequel/Prequel yang di-treat sebagai node
// "mainline" buat di-traverse lebih jauh (lihat fetchFranchiseRelations).
// Side Story/Alternative Version/dll cukup dicatat sebagai leaf, gak perlu
// ditelusuri relations-nya sendiri.
const MAINLINE_RELATIONS = new Set(['sequel', 'prequel'])

/**
 * Sort priority buat entry di dalam CORE_RELATIONS pas ditampilin — Sequel/
 * Prequel (mainline season) didahuluin drpd movie/side content.
 */
const RELATION_DISPLAY_PRIORITY: Record<string, number> = {
  sequel: 0,
  prequel: 0,
  'parent story': 1,
  'full story': 1,
  'alternative version': 1,
  'alternative setting': 1,
  'side story': 2,
}
function relationDisplayPriority(relation: string): number {
  return RELATION_DISPLAY_PRIORITY[relation.toLowerCase()] ?? 2
}

// Batas total node mainline (Sequel/Prequel chain) yang ditelusuri — safety
// valve buat franchise yang emang gede, BUKAN batasin "kedalaman"/hop.
//
// Catatan penting: versi awal fungsi ini sempet pakai hop-count limit (mis.
// max 5 langkah BFS). Itu SALAH — kalau dibuka dari ujung chain yang panjang
// (misal BnHA S1, dan sekarang ada 7 season), butuh lebih banyak hop buat
// nyampe ujung satunya (S6/S7) drpd kalau dibuka dari tengah (S3/S4), jadi
// hasilnya kepotong beda-beda tergantung titik masuknya — persis masalah
// konsistensi yang mau dibenerin dari awal. Makanya sekarang BFS-nya jalan
// terus sampe gak ada node baru ketemu (`visitedMainline` Set udah nyegah
// infinite loop/revisit), gak dibatesin jumlah hop.
const MAX_MAINLINE_NODES = 15

interface FranchiseEntry {
  mal_id: number
  name: string
  relation: string
}

/**
 * Nemuin SELURUH chain season (Sequel/Prequel) + movie/side content yang
 * nempel ke chain itu, dengan BFS multi-hop — bukan cuma baca satu-level
 * /relations dari anime yang lagi dibuka.
 *
 * Kenapa ini perlu: graph relasi di MAL gak selalu lengkap di tiap node.
 * Kadang S1 cuma nyebut S2 sebagai "Sequel" (gak nyebut S3 sama sekali),
 * padahal S2 nyebut S1 (Prequel) DAN S3 (Sequel). Kalau cuma baca relations
 * dari titik yang lagi dibuka doang, hasilnya jadi beda-beda tergantung
 * season mana yang lagi dibuka — S1 keliatan "lengkap", S2 keliatan
 * "cuma 1 doang". Dengan BFS, dari titik manapun bakal ketemu chain yang
 * SAMA, karena tiap hop nyari lebih jauh lewat Sequel/Prequel node yang
 * baru ketemu.
 */
async function fetchFranchiseRelations(rootMalId: string): Promise<FranchiseEntry[]> {
  const rootId = Number(rootMalId)
  const visitedMainline = new Set<number>([rootId])
  let queue: number[] = [rootId]
  const sideEntries = new Map<number, FranchiseEntry>()

  while (queue.length > 0 && visitedMainline.size <= MAX_MAINLINE_NODES) {
    const nextQueue: number[] = []

    for (const nodeId of queue) {
      const relJson = await safeFetchJikan(`${JIKAN}/anime/${nodeId}/relations`, REVALIDATE_COMPLETED)
      if (relJson && Array.isArray(relJson.data)) {
        for (const rel of relJson.data) {
          const relLower = String(rel.relation ?? '').toLowerCase()
          if (!CORE_RELATIONS.has(relLower)) continue

          for (const ent of (rel.entry ?? [])) {
            if (ent.type !== 'anime') continue

            if (MAINLINE_RELATIONS.has(relLower)) {
              if (!visitedMainline.has(ent.mal_id) && visitedMainline.size < MAX_MAINLINE_NODES) {
                visitedMainline.add(ent.mal_id)
                nextQueue.push(ent.mal_id)
              }
            } else if (!visitedMainline.has(ent.mal_id) && !sideEntries.has(ent.mal_id)) {
              sideEntries.set(ent.mal_id, { mal_id: ent.mal_id, name: ent.name, relation: rel.relation })
            }
          }
        }
      }
      // Jeda kecil antar node biar gak digebrak rate-limit Jikan (~3 req/s).
      await new Promise(r => setTimeout(r, 250))
    }

    queue = nextQueue
  }

  visitedMainline.delete(rootId)
  // Nama entry mainline gak penting di sini — judul asli diambil lagi pas
  // fetch detail per-entry di bawah. Relation dilabelin generik "Sequel";
  // nomor season yang bener dihitung belakangan lewat inferensi kronologis
  // (aired.from), jadi arah prequel/sequel relatif terhadap root gak
  // ngaruh ke hasil akhir.
  const mainlineEntries: FranchiseEntry[] = [...visitedMainline].map((mal_id) => ({
    mal_id,
    name: '',
    relation: 'Sequel',
  }))

  return [...mainlineEntries, ...sideEntries.values()]
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

/**
 * Safe fetch wrapper generik untuk endpoint non-Jikan (WAJIK, dll).
 * Retry lebih sederhana drpd safeFetchJikan karena gak ada perlakuan
 * khusus buat 429 — host lain jarang pakai rate-limit response yang sama.
 */
async function safeFetchJson(url: string, revalidate = 300, retries = 2, delayMs = 800, headers: Record<string, string> = {}): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { next: { revalidate }, headers })
      if (!res.ok) {
        console.error(`[anime-api] Fetch failed ${url} → ${res.status}`)
        if (i === retries - 1) return null
        await new Promise(r => setTimeout(r, delayMs))
        continue
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


// ─── Otakudesu ongoing list (via WAJIK) ──────────────────────────────────────
// Beda sama Jikan: ini scrape LANGSUNG dari halaman ongoing Otakudesu, jadi
// cuma anime yang beneran udah rilis episode-nya yang muncul di sini — gak
// ada anime "musim ini" yang season-nya udah mulai tapi episode-nya belum
// tayang, kayak yang suka nyelip lewat Jikan /seasons/now.
interface WajikOngoingItem {
  title: string
  poster: string
  episodes: string
  animeId: string
  latestReleaseDate: string
  releaseDay: string
  otakudesuUrl?: string
}

function mapWajikOngoingItem(a: WajikOngoingItem): AnimeListItem {
  return {
    animeId: a.animeId,
    title: a.title ?? '',
    poster: a.poster ?? '',
    episodes: a.episodes ?? '?',
    releaseDay: a.releaseDay?.toLowerCase() ?? '-',
    latestReleaseDate: a.latestReleaseDate ?? '',
    genres: [],
    score: null,
    status: 'Ongoing',
  } as AnimeListItem
}

// Error khusus: judul ketemu di Otakudesu tapi belum ke-index di MAL/Jikan
// (biasanya anime yang baru banget rilis episode 1-nya). Dibedakan dari error
// lain (network/timeout) supaya UI bisa kasih pesan yang lebih tepat daripada
// notFound() generik.
export class AnimeNotIndexedError extends Error {
  constructor(title: string) {
    super(`Anime "${title}" belum tersedia di database MyAnimeList/Jikan`)
    this.name = 'AnimeNotIndexedError'
  }
}

// Bersihin noise umum dari judul Otakudesu ("Sub Indo", "Season 2", dst)
// supaya query pencarian ke Jikan lebih akurat.
function normalizeTitle(raw: string): string {
  return raw
    .replace(/\bsub\s*indo\b/gi, '')
    .replace(/\bepisode\s*\d+\b/gi, '')
    .trim()
}

// Perbandingan kemiripan sederhana (tanpa dependency) — dipakai buat milih
// hasil pencarian Jikan yang paling relevan, bukan asal ambil index [0].
//
// Pakai ukuran himpunan kata TERKECIL sebagai penyebut (containment score),
// bukan yang terbesar. Judul resmi Jikan sering jauh lebih panjang (romaji +
// subtitle lengkap, bisa 10-15 kata) dibanding judul pendek hasil scrape dari
// Otakudesu (biasanya cuma 2-4 kata). Kalau pakai max(), semua kata pendek
// itu ketemu semua pun score-nya tetap kepotong parah cuma gara-gara judul
// resminya panjang — bikin anime yang jelas-jelas ada di Jikan malah
// keanggep "belum ke-index".
function similarity(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const wa = new Set(norm(a).split(' '))
  const wb = new Set(norm(b).split(' '))
  let overlap = 0
  for (const w of wa) if (wb.has(w)) overlap++
  return overlap / Math.max(Math.min(wa.size, wb.size), 1)
}

// Ekstrak nomor season dari judul ("Season 2", "2nd Season", "S2", "II", dst).
// null kalau gak ada penanda season sama sekali (dianggap season 1 default).
function extractSeasonNumber(title: string): number | null {
  const t = title.toLowerCase()
  const m =
    t.match(/season\s*(\d+)/) ||
    t.match(/(\d+)(?:st|nd|rd|th)\s*season/) ||
    t.match(/\bs(\d+)\b/)
  if (m) return parseInt(m[1], 10)
  const roman = t.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b/)
  if (roman) {
    const romanMap: Record<string, number> = {
      ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    }
    return romanMap[roman[1]]
  }
  return null
}

async function searchJikanBestMatch(query: string, originalTitle: string): Promise<number | null> {
  const res = await fetch(
    `${JIKAN}/anime?q=${encodeURIComponent(query)}&limit=5&sfw=true`,
    { next: { revalidate: 3600 } }
  )
  if (!res.ok) return null
  const json = await res.json()
  const candidates: any[] = Array.isArray(json?.data) ? json.data : []
  if (!candidates.length) return null

  const sourceSeason = extractSeasonNumber(originalTitle)

  let best = candidates[0]
  let bestScore = -1
  for (const c of candidates) {
    let score = Math.max(
      similarity(originalTitle, c.title ?? ''),
      similarity(originalTitle, c.title_english ?? ''),
    )

    // Kalau judul asli punya penanda season eksplisit dan beda sama season
    // kandidat ini, turunin score-nya drastis — containment score di atas
    // sengaja dibikin longgar (buat ngatasin judul panjang), jadi tanpa
    // pengecekan ini "Hell Mode S2" bisa aja malah kepilih ke Season 1.
    const candSeason =
      extractSeasonNumber(c.title ?? '') ?? extractSeasonNumber(c.title_english ?? '') ?? 1
    if (sourceSeason && sourceSeason !== candSeason) {
      score *= 0.2
    }

    if (score > bestScore) { bestScore = score; best = c }
  }
  // Kalau kemiripan terbaik tetap terlalu rendah, lebih baik anggap "belum
  // ketemu" daripada nyasar ke anime yang salah.
  return bestScore >= 0.3 ? best.mal_id : null
}

// ─── Raw info Otakudesu (dipakai buat resolve MAL ID & fallback detail) ─────
interface OtakudesuRawInfo {
  title: string
  poster?: string
  synopsis?: string
  genres?: string[]
  status?: string
  totalEpisodes?: number
  episodes?: { episodeNumber: number; title?: string; uploadDate?: string }[]
}

// Deteksi judul junk/generik dari Otakudesu — kejadian kalau scraper nyasar
// ke halaman selain halaman anime spesifik (404 yang redirect ke homepage,
// dst), jadi yang ke-scrape itu <title> situs-wide, bukan judul anime.
//
// ⚠️ Normalize dulu (buang tanda baca, rapetin spasi) SEBELUM dicocokin —
// bukan `.includes()` langsung ke string mentah. Kejadian nyata: judul junk
// asli Otakudesu itu "Otakudesu - Download, Nonton, dan Streaming Anime
// Subtitle Indonesia Lengkap dan Mudah" — ada KOMA setelah "Nonton". Guard
// lama nyari substring persis 'nonton dan streaming anime' (tanpa koma),
// jadi gagal match gara-gara beda satu tanda baca doang, dan judul junk itu
// lolos dianggap valid → seluruh chain di belakangnya (resolveToMalId,
// buildFallbackDetail) kebawa rusak (title/poster/synopsis semua garbage).
function isJunkOtakudesuTitle(title: string): boolean {
  const normalized = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.includes('nonton dan streaming anime')
    || normalized.includes('download nonton dan streaming')
}

// Ambil info mentah langsung dari Otakudesu (via proxy sendiri, fallback ke
// WAJIK). Dipisah dari resolveToMalId supaya bisa dipakai ulang buat bangun
// fallback detail kalau ternyata animenya belum ke-index di MAL/Jikan.
//
// ⚠️ Field poster/synopsis/genres/episodes di bawah nebak beberapa kemungkinan
// nama key dari response proxy/WAJIK lu — cocokin lagi sama shape asli
// `infoJson.data` / `wajikJson.data` di debug endpoint yang udah lu buat,
// kalau namanya beda tinggal sesuaikan bagian ambil field-nya aja.
async function fetchOtakudesuRawInfo(animeId: string): Promise<OtakudesuRawInfo | null> {
  // 1. Proxy sendiri dulu
  try {
    const proxyUrl = `${getBaseUrl()}/api/proxy/stream-indo?endpoint=anime-info&url=${encodeURIComponent(`https://otakudesu.blog/anime/${animeId}/`)}`
    const infoRes = await fetch(proxyUrl, { next: { revalidate: 3600 }, headers: internalFetchHeaders() })
    if (infoRes.ok) {
      const d = (await infoRes.json())?.data
      if (d?.title && !isJunkOtakudesuTitle(String(d.title))) {
        return {
          title: d.title,
          poster: d.poster ?? d.thumbnail ?? d.image ?? undefined,
          synopsis: d.synopsis ?? d.sinopsis ?? undefined,
          genres: Array.isArray(d.genres) ? d.genres.map((g: any) => (typeof g === 'string' ? g : g?.name)).filter(Boolean) : undefined,
          status: d.status ?? undefined,
          totalEpisodes: typeof d.totalEpisodes === 'number' ? d.totalEpisodes : undefined,
          episodes: Array.isArray(d.episodeList ?? d.episode_list ?? d.episodes)
            ? (d.episodeList ?? d.episode_list ?? d.episodes).map((ep: any, i: number) => ({
              episodeNumber: Number(ep.episode ?? ep.episodeNumber ?? i + 1),
              title: ep.title ?? undefined,
              uploadDate: ep.uploadDate ?? ep.date ?? undefined,
            }))
            : undefined,
        }
      }
    }
  } catch (err) {
    console.error(`[fetchOtakudesuRawInfo] proxy fetch failed for ${animeId}:`, err)
  }

  // 2. Fallback ke WAJIK
  try {
    const wajikRes = await fetch(`${WAJIK}/anime/${animeId}`, { next: { revalidate: 3600 } })
    if (wajikRes.ok) {
      const d = (await wajikRes.json())?.data
      if (d?.title && !isJunkOtakudesuTitle(String(d.title))) {
        return {
          title: d.title,
          poster: d.poster ?? d.thumbnail ?? undefined,
          synopsis: d.synopsis ?? undefined,
          genres: Array.isArray(d.genres) ? d.genres.map((g: any) => (typeof g === 'string' ? g : g?.name)).filter(Boolean) : undefined,
          status: d.status ?? undefined,
          totalEpisodes: typeof d.totalEpisodes === 'number' ? d.totalEpisodes : undefined,
          episodes: Array.isArray(d.episode_list ?? d.episodeList)
            ? (d.episode_list ?? d.episodeList).map((ep: any, i: number) => ({
              episodeNumber: Number(ep.episode ?? ep.episodeNumber ?? i + 1),
              title: ep.title ?? undefined,
              uploadDate: ep.date ?? ep.uploadDate ?? undefined,
            }))
            : undefined,
        }
      }
    }
  } catch (err) {
    console.error(`[fetchOtakudesuRawInfo] wajik fetch failed for ${animeId}:`, err)
  }

  return null
}

// ─── Resolve otakudesu title → MAL ID ────────────────────────────────────────
// Return null (bukan throw) kalau gak ketemu match yang cukup yakin di Jikan
// — pemanggil (detail()) yang memutuskan mau fallback ke data Otakudesu aja
// atau nyerah total.
async function resolveToMalId(rawTitle: string): Promise<string | null> {
  const cleaned = normalizeTitle(rawTitle)

  // Coba beberapa varian query: judul asli, judul yang dibersihkan, lalu
  // dengan/tanpa prefix "The" (banyak judul Inggris resmi pakai "The ...").
  const variants = new Set<string>([
    cleaned,
    rawTitle,
    cleaned.toLowerCase().startsWith('the ') ? cleaned.slice(4) : `The ${cleaned}`,
  ])

  for (const q of variants) {
    if (!q) continue
    const malId = await searchJikanBestMatch(q, cleaned)
    if (malId) return String(malId)
  }

  return null
}

// Bangun AnimeDetail langsung dari data Otakudesu doang, dipakai kalau anime
// belum ke-index di MAL/Jikan. Field yang cuma ada di Jikan (score, studio,
// aired, relations) dikosongin/di-default alih-alih nge-block seluruh halaman.
function buildFallbackDetail(animeId: string, info: OtakudesuRawInfo): AnimeDetail & { currentEpisode?: number } {
  const rawEpisodes = info.episodes && info.episodes.length > 0
    ? info.episodes
    : [{ episodeNumber: 1, title: 'Episode 1', uploadDate: undefined }]

  const episodes: EpisodeListItem[] = rawEpisodes.map((ep) => ({
    slug: `oteku-ep-${ep.episodeNumber}`,
    title: ep.title ?? `Episode ${ep.episodeNumber}`,
    episodeNumber: ep.episodeNumber,
    uploadDate: ep.uploadDate,
  }))

  const currentEpisode = episodes.reduce((m, e) => Math.max(m, e.episodeNumber ?? 0), 0)

  return {
    // ⚠️ Pakai slug Otakudesu ASLI (bukan malId) — gak ada malId buat anime
    // yang belum ke-index. Watch history & watchlist di-key pakai field ini,
    // jadi harus konsisten sama identifier yang dipakai di route /watch/[slug].
    slug: animeId,
    title: info.title,
    alternativeTitle: undefined,
    poster: info.poster ?? '',
    score: 0,
    status: info.status?.toLowerCase().includes('tamat') || info.status?.toLowerCase().includes('completed')
      ? 'Completed'
      : 'Ongoing',
    type: 'TV',
    totalEpisodes: info.totalEpisodes ?? episodes.length,
    aired: '',
    studio: 'Unknown',
    genres: (info.genres ?? []).map((g) => ({ slug: g.toLowerCase().replace(/\s+/g, '-'), name: g })),
    synopsis: info.synopsis ?? 'Sinopsis belum tersedia — anime ini baru rilis dan belum ke-index penuh di database kami.',
    episodes,
    relations: [],
    ...(currentEpisode > 0 && { currentEpisode }),
  }
}

async function scrapeOtakudesuOngoing(page = '1', revalidate = 300): Promise<AnimeListItem[]> {
  const pageNum = Math.max(1, parseInt(page, 10))
  let html: string | null = null
  let lastErr: Error | null = null

  const mirrors = [
    process.env.ANIME_INDO_BASE ?? 'https://otakudesu.blog',
    'https://otakudesu.fit',
  ]

  for (const mirror of mirrors) {
    const pageUrl = pageNum === 1
      ? `${mirror}/ongoing-anime/`
      : `${mirror}/ongoing-anime/page/${pageNum}/`
    try {
      const res = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
          'Referer': 'https://www.google.com/',
        },
        next: { revalidate },
        signal: AbortSignal.timeout(6000),
      })
      if (res.ok) {
        html = await res.text()
        if (html && html.toLowerCase().includes('<title>') && !html.toLowerCase().includes('404')) {
          break
        }
      }
    } catch (e) {
      lastErr = e as Error
    }
  }

  if (!html) {
    console.error('[anime-api] scrapeOtakudesuOngoing gagal dari semua mirror:', lastErr)
    return []
  }

  try {
    const $ = cheerio.load(html)
    const ongoingList: AnimeListItem[] = []

    $('.venz ul li').each((_, el) => {
      const $li = $(el)
      const $a = $li.find('.thumb a').first()
      const href = $a.attr('href') ?? ''
      if (!href) return

      const animeId = href.replace(/\/$/, '').split('/').pop() ?? ''
      if (!animeId) return

      const title = $li.find('h2.jdlflm').text().trim() || $a.attr('title')?.trim() || ''
      if (!title) return

      const poster = $li.find('.thumb img').first().attr('src') ?? ''
      const episodes = $li.find('.epz').text().trim().replace(/Episode\s*/i, '')
      const releaseDay = $li.find('.epztipe').text().trim()
      const latestReleaseDate = $li.find('.newnime').text().trim()

      ongoingList.push({
        animeId,
        title,
        poster,
        episodes,
        releaseDay: releaseDay.toLowerCase(),
        latestReleaseDate,
        genres: [],
        score: null,
        status: 'Ongoing',
      })
    })

    return ongoingList
  } catch (err) {
    console.error('[anime-api] scrapeOtakudesuOngoing parsing error:', err)
    return []
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const animeApi = {
  // ─── Detail ───────────────────────────────────────────────────────────────
  detail: async (animeId: string): Promise<AnimeDetail & { currentEpisode?: number }> => {
    let malId: string | null = null
    let rawInfo: OtakudesuRawInfo | null = null

    if (!isNaN(Number(animeId))) {
      // Slug numerik → udah pasti MAL ID, langsung skip proses resolve
      malId = animeId
    } else {
      rawInfo = await fetchOtakudesuRawInfo(animeId)
      if (!rawInfo) {
        // Bener-bener gak ketemu apa-apa, bahkan dari Otakudesu sendiri —
        // ini kasus yang layak dianggap "belum tersedia" beneran.
        throw new AnimeNotIndexedError(animeId)
      }
      malId = await resolveToMalId(rawInfo.title)
    }

    if (!malId) {
      // Ketemu di Otakudesu tapi belum ke-index di MAL/Jikan — tetep
      // tampilkan detailnya pakai data Otakudesu doang, jangan di-block.
      return buildFallbackDetail(animeId, rawInfo!)
    }

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
    // Pakai BFS multi-hop (fetchFranchiseRelations) supaya chain season yang
    // ketemu KONSISTEN mau dibuka dari season manapun — bukan cuma baca satu
    // level /relations dari anime yang lagi dibuka doang (lihat penjelasan
    // lengkap di komentar fetchFranchiseRelations).
    let relatedAnime: RelatedAnime[] = []
    // aired.from per malId — dipakai nanti buat inferensi nomor season
    // secara kronologis (lihat blok "Inferensi nomor season" di bawah).
    const airedFromByMalId = new Map<string, string | null>()
    try {
      const animeEntries = await fetchFranchiseRelations(malId)

      // Urutin dulu berdasarkan prioritas relation SEBELUM di-slice — Sequel/
      // Prequel (mainline season) didahuluin drpd movie/side content, biar
      // kalau franchise-nya kebetulan gede, season yang lebih penting tetep
      // ke-fetch duluan.
      animeEntries.sort((a, b) => relationDisplayPriority(a.relation) - relationDisplayPriority(b.relation))

      // Limit to 12 entries, fetch in batches of 3 with 400ms between batches
      const targetEntries = animeEntries.slice(0, 12)
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
          const type: string | undefined = d?.type ?? undefined
          // Buang tipe non-cerita (Music/PV/CM) — baru ketauan tipenya
          // sekarang, setelah detail-nya berhasil di-fetch. Ini yang
          // sebelumnya bikin "Official PV" numpang nongol di section
          // Seasons & Hubungan Anime kayak sequel beneran.
          if (type && NON_STORY_TYPES.has(type.toLowerCase())) continue
          const posterUrl = d?.images?.jpg?.large_image_url ?? d?.images?.jpg?.image_url
          airedFromByMalId.set(String(entry.mal_id), d?.aired?.from ?? null)
          relatedAnime.push({
            malId: String(entry.mal_id),
            title: d?.title ?? entry.name,
            relation: entry.relation,
            // Use undefined (not '') so the "No Poster" fallback renders
            poster: posterUrl || undefined,
            score: d?.score ?? undefined,
            type,
            status: d?.status ? mapStatus(d.status) : undefined,
          })
        }
      }
    } catch (err) {
      console.warn('[anime-api] Failed to fetch relations:', err)
    }

    // ── Post-process relations ──────────────────────────────────────────────
    // 1. Buang entry yang gak punya poster — biasanya data setengah matang
    //    (side content yang gak lengkap di Jikan), daripada nampilin kotak
    //    placeholder kosong di UI.
    // 2. Dedup berdasarkan malId — beberapa season kadang sama-sama nge-refer
    //    ke movie/OVA yang sama, jadi bisa nongol duplikat di relations.
    //    Movie asli yang beda-beda TETEP semua masuk, cuma yang bener-bener
    //    entry sama (malId sama) yang disaring jadi satu.
    // 3. Kalau judulnya ketauan nomor season-nya (lewat extractSeasonNumber,
    //    yang dipakai juga di logic resolve MAL ID), relabel jadi "Season N"
    //    dan urutin ascending — jadi konsisten "Season 1, 2, 3..." alih-alih
    //    urutan acak dari relations Jikan.
    relatedAnime = relatedAnime.filter((r) => !!r.poster)

    const seenMalIds = new Set<string>()
    relatedAnime = relatedAnime.filter((r) => {
      if (seenMalIds.has(r.malId)) return false
      seenMalIds.add(r.malId)
      return true
    })

    // ── Inferensi nomor season buat sequel bernama arc ────────────────────
    // extractSeasonNumber cuma nangkep penanda eksplisit di judul ("Season
    // 2", "2nd Season", "S2", dst). Sebagian sequel resmi malah dikasih
    // nama arc doang di MAL (contoh: JJK Season 3 judulnya "The Culling
    // Game: Part 1", gak ada angka season sama sekali) — jadi regex judul
    // gak bisa dipercaya sendirian buat kasus kayak gini.
    //
    // Fallback: kumpulin entry TV yang relation-nya Sequel/Prequel (berarti
    // emang bagian mainline, bukan movie/OVA/side story/PV), urutin
    // berdasarkan tanggal tayang (`aired.from`, termasuk anime yang lagi
    // dibuka halamannya sebagai anchor awal), terus kasih nomor season
    // berurutan. Entry yang judulnya emang eksplisit nyebut nomor dipakai
    // sebagai "anchor" — hitungan abis anchor itu ngikutin dari situ, jadi
    // campuran anchor eksplisit + tebakan kronologis tetep konsisten
    // (S1 → S2 eksplisit=2 → "Culling Game" nerusin jadi 3, bukan ke-skip).
    const isMainlineTv = (r: RelatedAnime): boolean => {
      const rel = r.relation.toLowerCase()
      const type = (r.type ?? '').toLowerCase()
      return (rel === 'sequel' || rel === 'prequel') && (type === 'tv' || type === '' || type === 'ona')
    }

    const timeline: { key: string; airedFrom: string | null; explicitSeason: number | null }[] = [
      // Anime yang lagi dibuka halamannya — dipakai sebagai anchor awal
      // kronologi, walau dia sendiri gak masuk ke daftar relations.
      { key: '__base__', airedFrom: a.aired?.from ?? null, explicitSeason: extractSeasonNumber(a.title ?? '') },
      ...relatedAnime
        .filter(isMainlineTv)
        .map((r) => ({
          key: r.malId,
          airedFrom: airedFromByMalId.get(r.malId) ?? null,
          explicitSeason: extractSeasonNumber(r.title),
        })),
    ]

    timeline.sort((x, y) => {
      if (!x.airedFrom && !y.airedFrom) return 0
      if (!x.airedFrom) return 1   // gak ada tanggal → taro belakang
      if (!y.airedFrom) return -1
      return new Date(x.airedFrom).getTime() - new Date(y.airedFrom).getTime()
    })

    const inferredSeasonByMalId = new Map<string, number>()
    let runningSeason: number | null = null
    for (const c of timeline) {
      runningSeason = c.explicitSeason != null
        ? c.explicitSeason
        : (runningSeason == null ? 1 : runningSeason + 1)
      if (c.key !== '__base__') inferredSeasonByMalId.set(c.key, runningSeason)
    }

    const seasonNumberOf = (r: RelatedAnime): number | null => {
      const fromTitle = extractSeasonNumber(r.title)
      if (fromTitle != null) return fromTitle
      const inferred = inferredSeasonByMalId.get(r.malId)
      if (inferred != null) return inferred
      // Gak ada penanda season eksplisit ATAU hasil inferensi kronologis
      // (berarti bukan entry TV Sequel/Prequel mainline) — anggap "Season 1"
      // cuma kalau relation-nya prequel, biar movie/side story/spin-off yang
      // emang bukan numbered season gak ke-label salah jadi "Season 1".
      return r.relation.toLowerCase().includes('prequel') ? 1 : null
    }

    relatedAnime = relatedAnime
      .map((r) => {
        const s = seasonNumberOf(r)
        return s != null ? { ...r, relation: `Season ${s}` } : r
      })
      .sort((a, b) => {
        const sa = a.relation.match(/^Season (\d+)$/)?.[1]
        const sb = b.relation.match(/^Season (\d+)$/)?.[1]
        if (sa && sb) return Number(sa) - Number(sb)
        if (sa) return -1   // yang ke-label Season N naik ke atas
        if (sb) return 1
        return 0            // sisanya (side story, spin-off, dll) tetep urutan asli
      })

    const altTitles: string[] = []
    if (a.title_english) altTitles.push(a.title_english)
    if (Array.isArray(a.title_synonyms)) {
      altTitles.push(...a.title_synonyms)
    }
    if (Array.isArray(a.titles)) {
      a.titles.forEach((t: any) => {
        if (t.title && typeof t.title === 'string' && t.type !== 'Japanese') {
          altTitles.push(t.title)
        }
      })
    }
    const uniqueAltTitles = [...new Set(altTitles)].filter(t => t !== a.title)

    return {
      slug: malId,
      title: a.title ?? '',
      alternativeTitle: a.title_english ?? undefined,
      altTitles: uniqueAltTitles,
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
    let [ongoing, completedJson] = await Promise.all([
      scrapeOtakudesuOngoing(page, REVALIDATE_ONGOING),
      safeFetchJikan(`${JIKAN}/top/anime?filter=bypopularity&page=${page}`, REVALIDATE_COMPLETED),
    ])

    const completed = Array.isArray(completedJson?.data)
      ? completedJson.data.map(mapJikanListItem)
      : []

    // Fallback jika Otakudesu diblokir Cloudflare di Vercel (maka scraping ongoing menghasilkan empty array)
    if (ongoing.length === 0) {
      console.warn('[anime-api] Otakudesu ongoing list is empty or blocked. Falling back to Jikan seasons/now...')
      const fallbackJson = await safeFetchJikan(`${JIKAN}/seasons/now?limit=24`, REVALIDATE_ONGOING)
      if (Array.isArray(fallbackJson?.data)) {
        ongoing = fallbackJson.data.map(mapJikanListItem)
      }
    }

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