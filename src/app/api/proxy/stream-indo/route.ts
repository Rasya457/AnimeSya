// app/api/proxy/stream-indo/route.ts
// v9 — Sokuja overhaul (App Router, gak punya __NEXT_DATA__ klasik):
//      1. video-mirrors: hit API /api/video-mirrors/?e={episodeId} langsung
//         buat direct MP4 per quality (sampai 1080p) drpd regex/RSC-scan HTML.
//         episodeId di-extract dari "episodeId":N di RSC payload halaman episode.
//      2. search: cleanSokujCardTitle() strip rank-badge ("10Dr. Stone...") +
//         type-badge ("...Part 3TV") yang nempel tanpa spasi di title hasil
//         scrape — junk ini bikin titleSimilarity gagal lolos threshold 0.45
//         walau anime-nya beneran match.
//      3. episode list: ganti primer dari scrape <a href> di seluruh halaman
//         anime (ternyata nyangkut widget rekomendasi anime LAIN + salah nomor
//         episode) ke API /api/playlist/?slug={episode-1 slug guess} yang
//         scoped bener ke anime itu doang.
// v8 — Direct-URL extraction race no longer blindly falls back to the
//      top-scored host (desustream) when it's confirmed dead (e.g. Cloudflare
//      526 from a broken origin cert). Now tracks which extractable hosts
//      actually failed and skips them when picking the iframe fallback too.
// v7 — Parallel mirror resolving + ranked direct URL extraction + unreleased episode filter
//      + skip score-0 hosts (streamtape/doodstream) entirely in extraction race
//      + global race timeout cap to prevent response stalling
//      + guard final fallback extraction against obfuscated-host iframes

import * as cheerio from 'cheerio'
import { Agent, fetch as undiciFetch } from 'undici'
import { samehadakuAdapter } from '@/lib/adapters/samehadaku'

export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────────────────────
// Mirror list — otakudesu.blog (classic) & otakudesu.fit (Animestream/Tsun theme)
// ─────────────────────────────────────────────────────────────────────────────
export const MIRRORS: readonly string[] = [
    // otakudesu.cloud (mirror lama) sekarang full-redirect ke otakudesu.blog —
    // dicek langsung per 18 Jun 2026, request ke otakudesu.cloud/anime/... balik
    // dengan destination_url otakudesu.blog/anime/.... Masih bisa dipakai (fetch
    // ikut redirect otomatis), tapi pakai domain final-nya langsung lebih stabil
    // dan menghindari ekstra hop / kemungkinan redirect berubah lagi nanti.
    process.env.ANIME_INDO_BASE ?? 'https://otakudesu.blog',  // ← ganti ini kalau domain berubah lagi
    'https://otakudesu.fit',
]

// ─────────────────────────────────────────────────────────────────────────────
// Consumet — self-hostable anime API, used as ad-free stream fast-path
// Set CONSUMET_API_URL in .env.local to point at your own instance.
// Public fallback is rate-limited; self-hosting is strongly recommended.
// ─────────────────────────────────────────────────────────────────────────────
const CONSUMET_BASE = (process.env.CONSUMET_API_URL ?? 'https://consumet-api.onrender.com').replace(/\/$/, '')
const CONSUMET_ENABLED = process.env.CONSUMET_ENABLED !== 'false' // opt-out via env
const CONSUMET_TIMEOUT_MS = 6_000

// ─────────────────────────────────────────────────────────────────────────────
// In-memory TTL cache
// ─────────────────────────────────────────────────────────────────────────────
interface CacheEntry<T> { data: T; expiresAt: number }
const _cache = new Map<string, CacheEntry<unknown>>()

function cacheGet<T>(key: string): T | null {
    const entry = _cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) { _cache.delete(key); return null }
    return entry.data as T
}

function cacheSet<T>(key: string, data: T, ttlMs = 5 * 60 * 1000) {
    _cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeout wrapper
// ─────────────────────────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`timeout-${ms}ms`)), ms)
        ),
    ])
}

// ─────────────────────────────────────────────────────────────────────────────
// raceAllWithCap — like Promise.allSettled, but with a hard wall-clock cap.
// Promise.allSettled always waits for the SLOWEST item before continuing,
// which is what let a single stuck mirror/query stall an entire request.
// This runs everything in parallel and returns as soon as either (a) all
// items have settled, or (b) capMs elapses — whichever comes first. Items
// that haven't settled by then are left as `undefined` in their original
// slot (order-preserving) and simply ignored; their underlying promises keep
// running in the background but nothing waits on them anymore.
// ─────────────────────────────────────────────────────────────────────────────
function raceAllWithCap<T>(promises: Promise<T>[], capMs: number): Promise<(T | undefined)[]> {
    return new Promise(resolve => {
        const results: (T | undefined)[] = new Array(promises.length).fill(undefined)
        if (promises.length === 0) { resolve(results); return }

        let remaining = promises.length
        const timer = setTimeout(() => resolve(results), capMs)

        promises.forEach((p, i) => {
            p.then(v => { results[i] = v })
                .catch(() => { /* leave slot undefined — caller filters these out */ })
                .finally(() => {
                    remaining -= 1
                    if (remaining === 0) {
                        clearTimeout(timer)
                        resolve(results)
                    }
                })
        })
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// DoH — PARALLEL Cloudflare + Google
// ─────────────────────────────────────────────────────────────────────────────
interface DohCacheEntry { ip: string; expiresAt: number }
const _dohCache = new Map<string, DohCacheEntry>()

async function dohResolve(hostname: string): Promise<string | null> {
    const cached = _dohCache.get(hostname)
    if (cached && Date.now() < cached.expiresAt) return cached.ip

    const resolvers = [
        `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
        `https://dns.google/resolve?name=${hostname}&type=A`,
    ]

    try {
        const ip = await withTimeout(
            Promise.any(
                resolvers.map(async url => {
                    const res = await fetch(url, {
                        headers: { Accept: 'application/dns-json' },
                        cache: 'no-store',
                    })
                    if (!res.ok) throw new Error('dns-err')
                    const json = await res.json() as any
                    const answer = (json.Answer ?? []).find((a: any) => a.type === 1)
                    if (!answer?.data) throw new Error('no-answer')
                    return answer.data as string
                })
            ),
            3_000
        )
        _dohCache.set(hostname, { ip, expiresAt: Date.now() + 60 * 60 * 1000 })
        return ip
    } catch {
        return null
    }
}

// Cache Agent per (hostname, ip)
const _agentCache = new Map<string, Agent>()

function getAgentFor(hostname: string, ip: string): Agent {
    const key = `${hostname}|${ip}`
    let agent = _agentCache.get(key)
    if (agent) return agent
    agent = new Agent({
        connect: {
            lookup: (_host, opts: any, cb) => {
                if (opts?.all) cb(null, [{ address: ip, family: 4 }])
                else cb(null, ip, 4)
            },
        },
    })
    _agentCache.set(key, agent)
    return agent
}

async function fetchWithDns(url: string, init?: RequestInit): Promise<Response> {
    try {
        const parsedUrl = new URL(url)
        const ip = await dohResolve(parsedUrl.hostname)
        if (!ip) return fetch(url, init)
        const agent = getAgentFor(parsedUrl.hostname, ip)
        return undiciFetch(url, { ...(init as any), dispatcher: agent }) as unknown as Response
    } catch {
        return fetch(url, init)
    }
}

const HTML_HDRS: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    'Cache-Control': 'no-cache',
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface SearchResult { title: string; url: string; thumb: string }
interface EpisodeEntry { episode: number; title: string; url: string }
interface MirrorOption { label: string; quality: string; content: Record<string, unknown> }

// Metadata halaman detail anime (title/poster/sinopsis/genre/dll). Selector-nya
// BEST-GUESS — lihat catatan lengkap di parseAnimeInfo().
interface AnimeInfo {
    title: string
    poster: string | null
    sinopsis: string | null
    genres: string[]
    status: string | null
    studio: string | null
    tipe: string | null
    totalEpisode: string | null
    durasi: string | null
    tanggalRilis: string | null
    skor: string | null
    produser: string | null
    japanese: string | null
}
interface StreamResult {
    iframe: string | null
    directUrl: string | null
    mirrors: MirrorOption[]
    resolved: boolean
    // Quality tiers (e.g. [720, 480, 360]) that actually had a resolvable
    // mirror for this episode — frontend uses this to know which buttons to
    // show in the quality selector instead of offering ones that don't exist.
    availableQualities: number[]
}
interface MirrorMeta { content: Record<string, unknown> }
interface ResolvedMirrorCandidate {
    mirror: MirrorOption
    iframe: string
    host: string
    hostScore: number
    qualityScore: number
    score: number
    // Numeric quality this mirror declared (720/480/360/...), or null if its
    // label/quality string didn't contain a recognizable resolution at all.
    declaredQuality: number | null
}
interface DirectVideoHit { iframe: string; directUrl: string }

// ─────────────────────────────────────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────────────────────────────────────
function extractSlug(url: string): string {
    return url.replace(/\/$/, '').split('/').pop() ?? ''
}

function rebaseMirrorUrl(url: string, newBase: string): string {
    for (const mirror of MIRRORS) {
        if (url.startsWith(mirror)) return url.replace(mirror, newBase)
    }
    return url
}

/**
 * Translate URL paths between different theme patterns across mirrors.
 * - Old theme uses /anime/ and /episode/ prefixes.
 * - New Tsun theme uses /series/ and direct slugs.
 */
function mapUrlForMirror(url: string, targetMirror: string): string {
    try {
        const parsed = new URL(url)
        const isNewTheme = targetMirror.includes('otakudesu.fit')

        let path = parsed.pathname
        if (isNewTheme) {
            path = path.replace(/^\/anime\//, '/series/')
            path = path.replace(/^\/episode\//, '/')
        } else {
            path = path.replace(/^\/series\//, '/anime/')
            if (!path.startsWith('/episode/') && /(?:episode|eps?)[_-]\d+/i.test(path)) {
                path = '/episode' + (path.startsWith('/') ? path : '/' + path)
            }
        }

        return `${targetMirror.replace(/\/$/, '')}${path}${parsed.search}`
    } catch {
        return url
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML scraper — races mirrors in parallel and falls back to DoH bypass if needed
// ─────────────────────────────────────────────────────────────────────────────
function isCloudflareChallenge(html: string): boolean {
    const lower = html.toLowerCase()
    return (
        lower.includes('just a moment') ||
        lower.includes('cf-browser-verification') ||
        lower.includes('_cf_chl') ||
        lower.includes('mohon tunggu sebentar') ||
        lower.includes('one moment, please') ||
        lower.includes('being verified') ||
        lower.includes('please wait while your request')
    )
}

async function fetchSingleUrl(url: string): Promise<string> {
    // 1. Direct fetch (fast path)
    try {
        const res = await withTimeout(
            fetch(url, { headers: HTML_HDRS, cache: 'no-store' }),
            4_000
        )
        if (res.ok) {
            const html = await res.text()
            if (
                html &&
                !isCloudflareChallenge(html) &&
                !html.toLowerCase().includes('<title>page not found') &&
                !html.toLowerCase().includes('<title>404')
            ) {
                return html
            }
        }
    } catch { /* fall through */ }

    // 2. DNS bypass
    const res = await withTimeout(
        fetchWithDns(url, { headers: HTML_HDRS, cache: 'no-store' }),
        5_000
    )
    if (!res.ok) throw new Error(`status-${res.status}`)

    const html = await res.text()
    if (
        isCloudflareChallenge(html) ||
        html.toLowerCase().includes('<title>page not found') ||
        html.toLowerCase().includes('<title>404')
    ) {
        throw new Error('invalid-html')
    }
    return html
}

export async function scrapeHtml(url: string): Promise<{ $: cheerio.CheerioAPI; html: string; base: string }> {
    const candidates = MIRRORS.map(mirror => ({
        base: mirror,
        url: mapUrlForMirror(url, mirror)
    }))

    try {
        const result = await Promise.any(
            candidates.map(async cand => {
                const html = await fetchSingleUrl(cand.url)
                if (!html || html.length < 1000) {
                    throw new Error('invalid-html')
                }
                return { $: cheerio.load(html), html, base: cand.base }
            })
        )
        return result
    } catch {
        throw new Error('SCRAPE_FAILED: Semua mirror diblokir atau unreachable')
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse helpers
// ─────────────────────────────────────────────────────────────────────────────
const INVALID_EPISODE_URL_RE = /^(?:#|javascript:|void\(0\))/i

// CSS classes Otakudesu puts on <li> rows for episodes that haven't aired yet.
// Checking classes is far more reliable than text scanning because Otakudesu
// never prints "coming soon" copy — it just gates the row visually.
const UNRELEASED_LI_CLASS_RE = /\b(?:locked|coming[-_]?soon|upcoming|unreleased|soon|belum[-_]?rilis|scheduled)\b/i

// Text-content patterns as a secondary signal (URL slugs + visible row text).
const COMING_SOON_TEXT_RE = /\b(?:coming\s*soon|upcoming|tba|segera\s*(?:rilis|tayang|hadir)|belum\s*(?:rilis|tayang|tersedia)|akan\s*(?:rilis|tayang)|jadwal\s*(?:rilis|tayang)?|rilis\s*\?|episode\s*\?)\b/i

// Indonesian month names → 0-indexed month number for date parsing.
const ID_MONTH: Record<string, number> = {
    januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
    juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
}

/**
 * Try to parse an Indonesian-formatted date string like "12 Januari 2025" or
 * "January 12, 2025". Returns a Date or null if unparseable.
 */
function parseIdDate(raw: string): Date | null {
    const s = raw.trim().toLowerCase()

    // "12 januari 2025" / "5 feb 2025"
    const idMatch = s.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/)
    if (idMatch) {
        const day = parseInt(idMatch[1], 10)
        const month = ID_MONTH[idMatch[2]] ?? ID_MONTH[Object.keys(ID_MONTH).find(k => k.startsWith(idMatch[2])) ?? '']
        const year = parseInt(idMatch[3], 10)
        if (month !== undefined && !isNaN(day) && !isNaN(year)) {
            return new Date(year, month, day)
        }
    }

    // ISO / "Jan 12, 2025" / anything Date can natively parse
    const native = new Date(raw)
    return isNaN(native.getTime()) ? null : native
}

/**
 * Returns true if this episode row should be excluded because the episode has
 * not yet been released.
 *
 * Detection priority (stops at first positive match):
 *  1. URL is placeholder (#, javascript:, void(0))
 *  2. <li> carries a known "unreleased" CSS class
 *  3. .epl-date text parses to a future date (> today, midnight local)
 *  4. URL slug or text content matches COMING_SOON_TEXT_RE patterns
 */
function isUnreleasedEpisode(
    title: string,
    url: string,
    liClasses: string,
    eplDateText: string,
    rowText = '',
): boolean {
    // 1. Placeholder / invalid href
    if (!url || INVALID_EPISODE_URL_RE.test(url.trim())) return true

    // 2. CSS class gate — most reliable Otakudesu signal
    if (liClasses && UNRELEASED_LI_CLASS_RE.test(liClasses)) return true

    // 3. Future date in .epl-date span
    if (eplDateText) {
        const d = parseIdDate(eplDateText)
        if (d) {
            const today = new Date(); today.setHours(0, 0, 0, 0)
            if (d > today) return true
        }
    }

    // 4. Text / URL slug pattern fallback
    const haystack = `${title} ${url} ${rowText}`.replace(/\s+/g, ' ').trim()
    if (COMING_SOON_TEXT_RE.test(haystack)) return true
    if (/coming[-_\s]*soon|upcoming|tba|belum[-_\s]*(?:rilis|tayang)|segera[-_\s]*(?:rilis|tayang)/i.test(url)) return true

    return false
}

// Thin compat shim so wajikEpisodes (which has no DOM context) can still call
// a single function with only the data it has available.
function isComingSoonEpisode(title: string, url: string, rawText = ''): boolean {
    return isUnreleasedEpisode(title, url, '', '', rawText)
}

function parsePositiveEpisodeParam(raw: string | null): number | null {
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
}

function filterByMaxEpisode(episodes: EpisodeEntry[], maxEpisode: number | null): EpisodeEntry[] {
    if (!maxEpisode) return episodes
    return episodes.filter(ep => ep.episode >= 0 && ep.episode <= maxEpisode)
}
/**
 * Parses episode number from title and URL.
 */
function parseEpisodeNumber(title: string, url: string): number {
    let clean = title.replace(/\s*(?:season|part|cour|s|arc)\s*\d+/gi, '')
        .replace(/\b(202\d|199\d|200\d|201\d)\b/g, '')
        .replace(/\b(?:480p|720p|1080p|360p|240p)\b/gi, '')
        .trim()

    const explicitMatch = clean.match(/(?:episode|ep\.?|eps|epsd)\s*(\d+(?:\.\d+)?)/i)
    if (explicitMatch) return parseFloat(explicitMatch[1])

    const standaloneMatch = clean.match(/\b(\d+(?:\.\d+)?)\b/)
    if (standaloneMatch) return parseFloat(standaloneMatch[1])

    const urlClean = url.replace(/\/$/, '').split('/').pop() ?? ''
    const urlExplicit = urlClean.match(/(?:episode|ep\.?|eps|epsd)[_-](\d+(?:\.\d+)?)/i)
    if (urlExplicit) return parseFloat(urlExplicit[1])

    const urlNumber = urlClean.match(/[_-](\d+(?:\.\d+)?)(?:[_-]|$)/)
    if (urlNumber) return parseFloat(urlNumber[1])

    return -1
}

/**
 * Parse episode list from anime page HTML.
 * Supports both old theme (`.episodelist li`) and Tsun theme (`.eplister li`).
 */
function parseEpisodes(html: string, base: string): EpisodeEntry[] {
    const $ = cheerio.load(html)
    const entries: EpisodeEntry[] = []

    $('.episodelist li, .eplister ul li, .eplister li').each((_, el) => {
        const a = $(el).find('a')
        const href = a.attr('href') ?? ''
        const eplNum = $(el).find('.epl-num').text().trim()
        const eplTitle = $(el).find('.epl-title').text().trim()
        const title = eplTitle || a.text().trim()
        const rowText = $(el).text().replace(/\s+/g, ' ').trim()

        // Otakudesu gates unreleased episodes via CSS class on <li> (e.g. "locked")
        // and/or a future date in .epl-date — check both, they're more reliable than text.
        const liClasses = ($(el).attr('class') ?? '').toLowerCase()
        const eplDateText = $(el).find('.epl-date, .epl-sub-date, [class*="date"]').first().text().trim()

        if (!href || !title) return
        if (/batch|lengkap/i.test(title) || /\/(batch|lengkap)\//i.test(href)) return
        // Otakudesu marks catalog gaps it hasn't backfilled yet with a literal
        // placeholder post (e.g. "Pembatas Episode | Episode 1 - 900 Dalam
        // Proses") sitting between two real episodes in the list. It has no
        // actual video and its title happens to contain a second "Episode N"
        // that parseEpisodeNumber's regex latches onto — silently creating a
        // bogus duplicate for whatever N that placeholder mentions.
        if (/pembatas|dalam proses/i.test(title)) return
        if (isUnreleasedEpisode(title, href, liClasses, eplDateText, rowText)) return

        const url = href.startsWith('http')
            ? rebaseMirrorUrl(href, base)
            : `${base}${href}`

        const epNum = parseEpisodeNumber(title, url)

        entries.push({ episode: epNum, title, url })
    })

    if (entries.length === 0) return []

    // Deduplicate by episode number, prioritizing entries with valid URLs
    const uniqueMap = new Map<number, EpisodeEntry>()
    for (const ep of entries) {
        if (ep.episode >= 0) {
            const existing = uniqueMap.get(ep.episode)
            if (!existing || (!existing.url && ep.url)) {
                uniqueMap.set(ep.episode, ep)
            }
        } else {
            uniqueMap.set(Math.random(), ep)
        }
    }
    const dedupedEntries = [...uniqueMap.values()]

    // Sort ASC by episode number; unknown (-1) ke paling belakang
    dedupedEntries.sort((a, b) => {
        if (a.episode < 0 && b.episode < 0) return 0
        if (a.episode < 0) return 1
        if (b.episode < 0) return -1
        return a.episode - b.episode
    })

    // Assign sequential fallback for episodes with unknown number
    let lastKnown = dedupedEntries.find(e => e.episode >= 0)?.episode ?? 0
    return dedupedEntries.map(ep => {
        if (ep.episode >= 0) { lastKnown = ep.episode; return ep }
        lastKnown += 1
        return { ...ep, episode: lastKnown }
    })
}

/**
 * Parse anime detail metadata (title/poster/sinopsis/genre/status/studio/dll)
 * from the SAME detail-page HTML that parseEpisodes() already consumes —
 * no extra fetch needed, scrapeHtml(animeUrl) already pulls the full page.
 *
 * ⚠️ BEST-GUESS SELECTORS — belum diverifikasi live di codebase ini, beda
 * sama parseEpisodes() yang selector-nya (.episodelist / .eplister) udah
 * kebukti jalan. Pola di bawah ngikutin struktur umum tema WordPress
 * Otakudesu (.infozingle buat key-value info, .fotoanime buat poster,
 * .sinopc buat sinopsis) tapi WAJIB di-cross-check dulu lewat
 * ?endpoint=debug-anime-info sebelum dipasang ke halaman detail production.
 * Kalau ada field yang selector-nya meleset, dia cuma balik null/[] —
 * gak throw — biar gak numbangin resolveEpisodeList() yang jalan bareng.
 */
function parseAnimeInfo(html: string, base: string): AnimeInfo | null {
    const $ = cheerio.load(html)

    // Title — beberapa kandidat heading dulu, fallback ke <title> tag
    const title =
        $('.jdlrx h1').first().text().trim() ||
        $('h1.jdlrx').first().text().trim() ||
        $('.infozingle h1').first().text().trim() ||
        $('h1').first().text().trim() ||
        $('title').first().text().replace(/\s*[-|].*$/, '').trim()

    // Kalau title aja gagal ke-parse, kemungkinan besar ini bukan halaman
    // detail anime (mirror kena redirect ke 404/halaman lain) — bail early
    // drpd ngebalikin object kosong yang keliatan "berhasil" padahal enggak.
    if (!title) return null

    // Poster
    let poster: string | null =
        $('.fotoanime img').first().attr('src') ??
        $('.venz .thumb img').first().attr('src') ??
        $('.thumb img').first().attr('src') ??
        $('meta[property="og:image"]').attr('content') ??
        null
    if (poster && !poster.startsWith('http')) {
        poster = poster.startsWith('/') ? `${base}${poster}` : `${base}/${poster}`
    }

    // Sinopsis — gabung semua <p> di container sinopsis
    const sinopsisParts: string[] = []
    $('.sinopc p, .venser .sinopc p, .sinopsis p').each((_, el) => {
        const t = $(el).text().trim()
        if (t) sinopsisParts.push(t)
    })
    const sinopsis = sinopsisParts.length > 0 ? sinopsisParts.join('\n\n') : null

    // Key-value fields dari .infozingle p — format umum tema Otakudesu:
    // <p><span>Label</span>: Value</p>. Genre biasanya barisnya isi <a> list
    // drpd plain text, jadi ditangani terpisah.
    const fields: Record<string, string> = {}
    const genres: string[] = []
    $('.infozingle p').each((_, el) => {
        const $el = $(el)
        const rawText = $el.text().replace(/\s+/g, ' ').trim()
        const firstColon = rawText.indexOf(':')
        if (firstColon === -1) return

        const label = rawText.substring(0, firstColon).trim().toLowerCase()
        if (label.startsWith('genre')) {
            $el.find('a').each((_, a) => {
                const g = $(a).text().trim()
                if (g) genres.push(g)
            })
            return
        }

        const value = rawText.substring(firstColon + 1).trim()
        if (value) fields[label] = value
    })

    const pick = (...keys: string[]): string | null => {
        for (const k of keys) if (fields[k]) return fields[k]
        return null
    }

    return {
        title,
        poster,
        sinopsis,
        genres,
        status: pick('status'),
        studio: pick('studio'),
        tipe: pick('tipe', 'type'),
        totalEpisode: pick('total episode', 'total ep'),
        durasi: pick('durasi'),
        tanggalRilis: pick('tanggal rilis', 'rilis'),
        skor: pick('skor', 'score'),
        produser: pick('produser', 'producer'),
        japanese: pick('japanese'),
    }
}

// Some older Otakudesu BD/batch uploads accidentally list a pure
// file-hosting service as a STREAMING mirror option (alongside real video
// embeds like desustream/playdesu). These are download landing pages, not
// video embeds — trying to <iframe> one can only ever dead-end (e.g.
// Solidfiles giving a flat-out NXDOMAIN on an old/rotated link), regardless
// of how well the AJAX resolve itself succeeds. They're filtered out here
// only — parseDownloadLinks() still lists them normally, since they're
// perfectly legitimate as download mirrors.
const NON_VIDEO_MIRROR_LABELS = [
    'solidfiles', 'zippyshare', 'racaty', 'letsup', 'mega', 'mediafire',
    'gdrive', 'drive.google', 'uptobox', 'terabox', 'acefile', 'krakenfiles',
]

function isNonVideoMirrorLabel(label: string): boolean {
    const l = label.toLowerCase()
    return NON_VIDEO_MIRROR_LABELS.some(h => l.includes(h))
}

function parseMirrors(html: string): MirrorOption[] {
    const $ = cheerio.load(html)
    const mirrors: MirrorOption[] = []

    // Format Otakudesu sekarang: setiap opsi mirror/kualitas adalah
    // <a href="#" data-content="<base64 JSON>">label</a> di dalam .mirrorstream.
    // Semua parameter (id/post/nume/type, dll) sudah di-encode jadi satu blob
    // base64 JSON — kita decode apa adanya dan spread langsung ke payload AJAX,
    // tanpa perlu tahu nama field-nya satu-satu.
    //
    // Coba beberapa selector sekaligus untuk kompatibilitas tema lama & baru:
    const MIRROR_SELECTORS = [
        '.mirrorstream a[href^="#"][data-content]',
        '.server a[href^="#"][data-content]',
        '.mirror a[href^="#"][data-content]',
        '.player-list a[href^="#"][data-content]',
        'a[href^="#"][data-content]',   // broad fallback
    ]

    const seen = new Set<string>()

    for (const selector of MIRROR_SELECTORS) {
        $(selector).each((_, el) => {
            const a = $(el)
            const raw = a.attr('data-content') ?? ''
            if (!raw || seen.has(raw)) return
            seen.add(raw)

            let content: Record<string, unknown> | null = null
            try {
                // data-content may be plain base64 JSON or raw JSON string
                const decoded = Buffer.from(raw, 'base64').toString('utf-8')
                content = JSON.parse(decoded.startsWith('{') ? decoded : raw)
            } catch {
                try { content = JSON.parse(raw) } catch { return }
            }
            if (!content || typeof content !== 'object') return

            const label = a.text().trim()
            if (isNonVideoMirrorLabel(label)) return
            // Quality label biasanya ada di heading/elemen sebelum <ul> yang
            // membungkus <li> berisi link ini (mis. "360p", "480p", "720p").
            const li = a.closest('li')
            const qualEl = (li.length ? li : a).closest('ul').prevAll('div,h3,span,strong,p').first()
            const quality = qualEl.text().trim() || 'unknown'

            mirrors.push({ label, quality, content })
        })
        if (mirrors.length > 0) break  // stop at first working selector
    }

    return mirrors
}

// ─────────────────────────────────────────────────────────────────────────────
// Download links — bagian "Link Download ... Lengkap" di halaman episode,
// BEDA dari .mirrorstream (streaming embed) yang ditangani parseMirrors().
// Strukturnya per-kualitas: satu <li> berisi label "Mp4 360p"/"Mkv 720p" diikuti
// beberapa <a> host (Zippy, Hxfile, Racaty, KFiles, Mega, MegaUp, dst) lalu
// ukuran file. Kita filter pakai teks LABEL-nya sendiri (anchor di-strip dulu)
// supaya tidak ketuker sama <li> di .mirrorstream yang isinya cuma satu nama
// host polos (tanpa label "Mp4/Mkv NNNp" di depannya).
// ─────────────────────────────────────────────────────────────────────────────
interface DownloadHost { name: string; url: string }
interface DownloadQualityGroup { format: string; quality: string; sizeLabel: string | null; hosts: DownloadHost[] }

const DOWNLOAD_QUALITY_LABEL_RE = /^(mp4|mkv)\s*(\d+p)\b/i

function parseDownloadLinks(html: string): DownloadQualityGroup[] {
    const $ = cheerio.load(html)
    const groups: DownloadQualityGroup[] = []

    $('li').each((_, el) => {
        const $li = $(el)
        // Buang dulu semua <a> sebelum baca teks label — supaya nama host
        // (Zippy/Mega/dst) tidak nyampur dengan label kualitas yang kita cari.
        const ownText = $li.clone().find('a').remove().end().text().replace(/\s+/g, ' ').trim()
        const match = ownText.match(DOWNLOAD_QUALITY_LABEL_RE)
        if (!match) return

        const hosts: DownloadHost[] = []
        $li.find('a').each((_, a) => {
            const href = $(a).attr('href') ?? ''
            const name = $(a).text().trim()
            if (href && name) hosts.push({ name, url: href })
        })
        if (hosts.length === 0) return

        const sizeMatch = ownText.match(/([\d.]+\s*(?:KB|MB|GB))/i)
        groups.push({
            format: match[1].toLowerCase(),
            quality: match[2].toLowerCase(),
            sizeLabel: sizeMatch ? sizeMatch[1] : null,
            hosts,
        })
    })

    return groups
}

/** Cari link host tertentu (mis. "mega") di kualitas tertentu (mis. "720p"). */
function findDownloadHost(groups: DownloadQualityGroup[], quality: string, hostName: string): string | null {
    const q = quality.toLowerCase()
    const h = hostName.toLowerCase()
    const group = groups.find(g => g.quality === q)
    if (!group) return null
    return group.hosts.find(host => host.name.toLowerCase() === h)?.url ?? null
}

// desustream.com (link.desustream.com) adalah shortlink Otakudesu sendiri yang
// membungkus URL host asli (Mega/Zippy/dst). BELUM TERVERIFIKASI dari sini
// (tidak bisa kirim header custom lewat web_fetch saat investigasi) — saat
// diakses tanpa Referer yang sesuai, link ini fallback ke halaman landing
// Otakudesu biasa alih-alih redirect ke Mega. Fungsi ini best-effort kirim
// Referer = url episode asal, mengikuti pola yang sudah dipakai di
// fetchNonce()/resolveSingleMirrorBase() — WAJIB DITES LANGSUNG di server
// kamu untuk konfirmasi apakah ini cukup untuk mendapat redirect Location
// yang benar ke mega.nz.
async function resolveDesuStreamLink(shortUrl: string, refererEpisodeUrl: string): Promise<string | null> {
    try {
        const res = await withTimeout(
            fetch(shortUrl, {
                headers: { ...HTML_HDRS, Referer: refererEpisodeUrl },
                redirect: 'manual',
            }),
            6_000
        )
        const location = res.headers.get('location')
        if (location) return location
        // Tidak ada redirect HTTP — kemungkinan target asli disisipkan sebagai
        // meta-refresh/JS di body, bukan Location header. Coba cari pola umum.
        const body = await res.text()
        const metaMatch = body.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'>]+)/i)
        if (metaMatch) return metaMatch[1]
        return null
    } catch {
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Nonce — Otakudesu sekarang TIDAK embed nonce di HTML statis. Harus di-fetch
// via AJAX terpisah (action hash di bawah) sebelum bisa resolve mirror.
// Response: { data: "<nonce string>" }
// ─────────────────────────────────────────────────────────────────────────────
const NONCE_ACTION = 'aa1208d27f29ca340c92c66d1926f13f'
const EMBED_ACTION = '2a3505c93b0035d3f455df82bf976b84'

async function fetchNonce(base: string, referer: string): Promise<string | null> {
    const cacheKey = `nonce:${base}`
    const cached = cacheGet<string>(cacheKey)
    if (cached) return cached

    // Strategy 1: standard AJAX nonce fetch
    try {
        const res = await withTimeout(
            fetchWithDns(`${base}/wp-admin/admin-ajax.php`, {
                method: 'POST',
                headers: {
                    ...HTML_HDRS,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': rebaseMirrorUrl(referer, base),
                    'Origin': base,
                },
                body: new URLSearchParams({ action: NONCE_ACTION }).toString(),
            }),
            8_000
        )
        if (res.ok) {
            const json = await res.json() as { data?: string; nonce?: string }
            const nonce = ((json.data ?? json.nonce) ?? '').trim()
            if (nonce) {
                // Nonce ini sepertinya per-request/short-lived — cache singkat saja
                // supaya request beruntun dalam waktu dekat gak fetch ulang terus.
                cacheSet(cacheKey, nonce, 60 * 1000)
                return nonce
            }
        }
    } catch { /* fall through to strategy 2 */ }

    // Strategy 2: extract nonce from episode page HTML
    // Otakudesu sometimes embeds the nonce inline as a JS variable or data-attribute.
    try {
        const episodeRes = await withTimeout(
            fetchWithDns(rebaseMirrorUrl(referer, base), {
                headers: HTML_HDRS,
                cache: 'no-store',
            }),
            6_000
        )
        if (episodeRes.ok) {
            const html = await episodeRes.text()
            // Look for nonce in common inline patterns:
            // var nonce = "abc123"
            // "nonce":"abc123"
            // data-nonce="abc123"
            const patterns = [
                /var\s+nonce\s*=\s*["']([a-f0-9]+)["']/i,
                /["']nonce["']\s*:\s*["']([a-f0-9]+)["']/i,
                /data-nonce=["']([a-f0-9]+)["']/i,
                /nonce["']?\s*[:=]\s*["']([a-f0-9]{8,})["']/i,
            ]
            for (const pat of patterns) {
                const match = html.match(pat)
                if (match?.[1]) {
                    const nonce = match[1]
                    cacheSet(cacheKey, nonce, 30 * 1000)  // shorter cache for HTML-extracted nonces
                    return nonce
                }
            }
        }
    } catch { /* silent */ }

    return null
}

// ─────────────────────────────────────────────────────────────────────────────
// AJAX mirror resolver — parallel race across mirrors
// ─────────────────────────────────────────────────────────────────────────────
async function resolveSingleMirrorBase(
    base: string,
    meta: MirrorMeta,
    referer: string,
): Promise<string> {
    const nonce = await fetchNonce(base, referer)
    if (!nonce) throw new Error('no-nonce')

    // meta.content adalah hasil decode data-content (base64 JSON) apa adanya —
    // spread langsung ke payload, tambah nonce + action embed.
    const bodyParams: Record<string, string> = {}
    for (const [k, v] of Object.entries(meta.content)) {
        bodyParams[k] = typeof v === 'string' ? v : JSON.stringify(v)
    }
    bodyParams.nonce = nonce
    bodyParams.action = EMBED_ACTION

    const res = await withTimeout(
        fetchWithDns(`${base}/wp-admin/admin-ajax.php`, {
            method: 'POST',
            headers: {
                ...HTML_HDRS,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': rebaseMirrorUrl(referer, base),
                'Origin': base,
            },
            body: new URLSearchParams(bodyParams).toString(),
        }),
        8_000
    )

    if (!res.ok) {
        // Nonce mungkin invalid/expired — buang dari cache supaya percobaan
        // berikutnya fetch nonce baru.
        _cache.delete(`nonce:${base}`)
        throw new Error(`ajax-${res.status}`)
    }

    const json = await res.json() as { data?: string }
    if (!json.data) {
        _cache.delete(`nonce:${base}`)
        throw new Error('empty-data')
    }

    // Response data adalah base64-encoded HTML fragment berisi <iframe>
    let fragment = ''
    try {
        fragment = Buffer.from(json.data, 'base64').toString('utf-8')
    } catch {
        fragment = json.data
    }
    if (!fragment) throw new Error('empty-fragment')

    const $ = cheerio.load(fragment)
    const src = ($('iframe').attr('src') ?? $('iframe').attr('data-src') ?? '').trim()
    if (!src) throw new Error('no-iframe-src')
    return src
}

async function resolveMirrorUrl(
    meta: MirrorMeta,
    referer: string,
    preferredBase?: string,
): Promise<string | null> {
    const ordered = preferredBase
        ? [preferredBase, ...MIRRORS.filter(m => m !== preferredBase)]
        : [...MIRRORS]

    try {
        return await Promise.any(
            ordered.map(base => resolveSingleMirrorBase(base, meta, referer))
        )
    } catch {
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Title variants (for fuzzy search)
// ─────────────────────────────────────────────────────────────────────────────
const JP_PARTICLES = /\s+\b(no|wa|ga|wo|ni|to|de|mo|ya|ka|na|yo|ne|he)\b/gi

function cleanOtakuTitle(raw: string): string {
    return raw
        .replace(/\s*(Batch|\[BATCH\]|Sub\s*Indo|Subtitle\s*Indonesia|\d{1,2}\s+\w+,?\s*\d{4}).*/i, '')
        .replace(/\s+/g, ' ')
        .trim() || raw.trim()
}

// MAL/Jikan titles often use ordinal-word seasons ("Haikyuu!! Second Season"),
// while Otakudesu listings are almost always numeral-based ("Haikyuu Season
// 2"). Without converting between the two, neither the search query nor the
// similarity scorer can recognize they're the same season — query variants
// never textually match Otakudesu's title, and even if a result somehow
// turns up, every numbered season scores identically against an ordinal-word
// primary (none of them literally contain the word "second"), so there's no
// way to tell Season 2 apart from Season 3 in the candidate ranking.
const ORDINAL_SEASON_WORDS: Record<string, string> = {
    first: '1', second: '2', third: '3', fourth: '4', fifth: '5',
    sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10',
}

function normalizeOrdinalSeason(s: string): string {
    return s.replace(
        /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/gi,
        (_, word: string) => `Season ${ORDINAL_SEASON_WORDS[word.toLowerCase()]}`
    )
}

function titleVariants(raw: string): string[] {
    const variants = new Set<string>()
    const clean = raw.trim()
    variants.add(clean)

    // "Second Season" → "Season 2" dst, so this becomes the basis for
    // noSubtitle/noSeason below — that's what lets noSeason's digit-only
    // regex actually strip it down to the bare franchise title too.
    const ordinalNormalized = normalizeOrdinalSeason(clean)
    if (ordinalNormalized !== clean) variants.add(ordinalNormalized)
    const seasonSource = ordinalNormalized

    const noSubtitle = seasonSource.split(/[:\u2014\-]/)[0].trim()
    if (noSubtitle && noSubtitle !== clean) variants.add(noSubtitle)

    const noSeason = seasonSource.replace(/\s*(season|part|cour|s)\s*\d+/gi, '').trim()
    if (noSeason && noSeason !== clean) variants.add(noSeason)

    const twoWords = clean.split(' ').slice(0, 2).join(' ')
    if (twoWords.length > 3) variants.add(twoWords)

    const noRoman = clean.replace(/\b(II|III|IV|VI|VII|VIII|IX)\b/g, m => {
        const map: Record<string, string> = { II: '2', III: '3', IV: '4', VI: '6', VII: '7', VIII: '8', IX: '9' }
        return map[m] ?? m
    })
    if (noRoman !== clean) variants.add(noRoman)

    const noParticle = clean.replace(JP_PARTICLES, ' ').replace(/\s+/g, ' ').trim()
    if (noParticle && noParticle !== clean) {
        variants.add(noParticle)
        const npNoSub = noParticle.split(/[:\u2014\-]/)[0].trim()
        if (npNoSub && npNoSub !== noParticle) variants.add(npNoSub)
    }

    return [...variants]
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML-based search (replaces WP REST API which requires auth)
// Races all mirrors in parallel for maximum speed
// ─────────────────────────────────────────────────────────────────────────────
async function htmlSearch(q: string): Promise<{ results: SearchResult[]; base: string } | null> {
    const cacheKey = `html-search:${q}`
    const cached = cacheGet<{ results: SearchResult[]; base: string }>(cacheKey)
    if (cached) return cached

    try {
        const outcomes = await Promise.allSettled(
            MIRRORS.map(async base => {
                const isNewTheme = base.includes('otakudesu.fit')
                const searchUrl = isNewTheme
                    ? `${base}/?s=${encodeURIComponent(q)}`
                    : `${base}/?s=${encodeURIComponent(q)}&post_type=anime`

                const { $, html } = await scrapeHtml(searchUrl)
                const results: SearchResult[] = []

                if (isNewTheme) {
                    $('.listupd article.bs, .listupd .bsx').each((_, el) => {
                        const a = $(el).find('a').first()
                        const href = a.attr('href') ?? ''
                        const title = a.attr('title')?.trim() || a.find('.tt h2').text().trim() || a.find('.tt').text().trim()
                        const thumb = a.find('img').attr('src') ?? ''
                        if (href && title) {
                            results.push({ title: cleanOtakuTitle(title), url: href, thumb })
                        }
                    })
                } else {
                    $('.chivsrc li').each((_, el) => {
                        const a = $(el).find('a').first()
                        const href = a.attr('href') ?? ''
                        const title = a.text().trim()
                        const thumb = $(el).find('img').attr('src') ?? ''
                        if (href && title) {
                            results.push({ title: cleanOtakuTitle(title), url: href, thumb })
                        }
                    })
                }

                if (results.length === 0) throw new Error('no-results')
                return { results, base }
            })
        )

        const allResults: SearchResult[] = []
        let primaryBase = MIRRORS[0]
        let primaryBaseSet = false

        for (const out of outcomes) {
            if (out.status === 'fulfilled' && out.value) {
                allResults.push(...out.value.results)
                // Bug fix: latch on first successful mirror instead of overwriting
                // with each fulfilled result (last-write-wins was wrong behaviour)
                if (!primaryBaseSet) {
                    primaryBase = out.value.base
                    primaryBaseSet = true
                }
            }
        }

        if (allResults.length === 0) return null

        // Deduplicate results by URL
        const seenUrls = new Set<string>()
        const dedupedResults = allResults.filter(r => {
            if (seenUrls.has(r.url)) return false
            seenUrls.add(r.url)
            return true
        })

        const out = { results: dedupedResults, base: primaryBase }
        cacheSet(cacheKey, out, 10 * 60 * 1000)
        return out
    } catch {
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Jikan — alt titles dari MAL ID
// ─────────────────────────────────────────────────────────────────────────────
interface JikanAnimeInfo {
    title: string
    title_english: string | null
    titles: Array<{ title?: string }>
}

async function fetchJikanTitlesByMalId(malId: string): Promise<{ primary: string; alts: string[] } | null> {
    const cacheKey = `jikan-by-id:${malId}`
    const cached = cacheGet<{ primary: string; alts: string[] }>(cacheKey)
    if (cached) return cached

    try {
        const res = await withTimeout(
            fetch(`https://api.jikan.moe/v4/anime/${malId}`, {
                headers: { Accept: 'application/json' },
            }),
            5_000
        )
        if (!res.ok) return null

        const json = await res.json() as { data?: JikanAnimeInfo }
        const anime = json.data
        if (!anime) return null

        const primary = anime.title
        const alts = [
            anime.title_english,
            ...(anime.titles ?? []).map(t => t.title),
        ].filter((t): t is string => !!t && t !== primary)

        const result = { primary, alts: [...new Set(alts)] }
        cacheSet(cacheKey, result, 60 * 60 * 1000)
        return result
    } catch {
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Title similarity scorer — returns 0-1 (1 = perfect match)
// ─────────────────────────────────────────────────────────────────────────────
function titleSimilarity(a: string, b: string): number {
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
    // word overlap
    const wordsA = new Set(na.split(' '))
    const wordsB = new Set(nb.split(' '))
    const intersection = [...wordsA].filter(w => wordsB.has(w) && w.length > 2)
    const union = new Set([...wordsA, ...wordsB])
    return intersection.length / union.size
}

// ─────────────────────────────────────────────────────────────────────────────
// wajik API fast-path — tries the public wajik-anime-api first (JSON API)
// Much faster than HTML scraping when it works
// ─────────────────────────────────────────────────────────────────────────────
async function wajikSearch(q: string): Promise<SearchResult[] | null> {
    const cacheKey = `wajik-search:${q}`
    const cached = cacheGet<SearchResult[]>(cacheKey)
    if (cached) return cached

    try {
        const res = await withTimeout(
            fetch(`https://wajik-anime-api.vercel.app/otakudesu/search?q=${encodeURIComponent(q)}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            }),
            5_000
        )
        if (!res.ok) return null
        const json = await res.json() as any
        const items: any[] = json?.data ?? []
        if (!Array.isArray(items) || items.length === 0) return null

        const results: SearchResult[] = items.map((item: any) => ({
            title: cleanOtakuTitle(item.title ?? ''),
            url: item.url ?? item.animeUrl ?? '',
            thumb: item.poster ?? item.image ?? item.thumbnail ?? '',
        })).filter(r => r.title && r.url)

        if (results.length === 0) return null
        cacheSet(cacheKey, results, 10 * 60 * 1000)
        return results
    } catch {
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumet helpers — AniList ID lookup + episode resolution + stream fetch
// ─────────────────────────────────────────────────────────────────────────────
interface ConsumetSource { url: string; quality: string; isM3U8: boolean }
interface ConsumetEpisode { id: string; number: number; title?: string }
interface ConsumetStreamResult { sources?: ConsumetSource[]; subtitles?: Array<{ lang: string; url: string }> }
interface ConsumetAnimeInfo {
    title?: { romaji?: string; english?: string; native?: string }
    episodes?: ConsumetEpisode[]
}

/** Resolve AniList ID from a MAL ID via AniList GraphQL. Cached for 24 h (ID never changes). */
async function anilistIdFromMalId(malId: string): Promise<number | null> {
    const cacheKey = `anilist-id:${malId}`
    const cached = cacheGet<number>(cacheKey)
    if (cached) return cached

    try {
        const res = await withTimeout(
            fetch('https://graphql.anilist.co', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    query: `{ Media(idMal: ${parseInt(malId, 10)}, type: ANIME) { id } }`,
                }),
                cache: 'no-store',
            }),
            4_000
        )
        if (!res.ok) return null
        const json = await res.json() as { data?: { Media?: { id: number } } }
        const id = json?.data?.Media?.id
        if (!id) return null
        cacheSet(cacheKey, id, 24 * 60 * 60 * 1000)
        return id
    } catch {
        return null
    }
}

// Below this, a Consumet-side title match is trusted. Below CROSS_SOURCE_TITLE_THRESHOLD's
// spirit but kept separate/lower since AniList's own title strings (romaji/english/native)
// tend to be cleaner than scraped card titles, so matches against them can afford to be
// a bit stricter without the "no" / short-word noise scraped titles have.
const CONSUMET_TITLE_MIN_SCORE = 0.5

/**
 * Fetch anime info from Consumet and return the episode ID for `episodeNum` —
 * but ONLY if the anime Consumet actually resolved (via its own internal
 * fuzzy search against the zoro/HiAnime provider) is a decent title match
 * for what we asked for. Consumet's `/meta/anilist/info/:id` doesn't use a
 * real AniList->provider ID mapping under the hood — Zoro has no such
 * mapping — so it silently does its own title search and returns whatever
 * it thinks is closest. For movies/short titles that can land on a
 * completely different anime while still returning a 200 with real-looking
 * episode data, which is exactly how "Koe no Katachi" was serving the
 * wrong video even after the Otakudesu-side fix: this path was never
 * checked at all, and it wins over Otakudesu whenever it succeeds.
 */
async function consumetFindEpisodeId(
    anilistId: number,
    episodeNum: number,
    expectedTitle: string
): Promise<string | null> {
    const cacheKey = `consumet-info:${anilistId}`
    let info = cacheGet<ConsumetAnimeInfo>(cacheKey)

    if (!info) {
        try {
            const res = await withTimeout(
                fetch(`${CONSUMET_BASE}/meta/anilist/info/${anilistId}?provider=zoro`, {
                    headers: { Accept: 'application/json' },
                    cache: 'no-store',
                }),
                CONSUMET_TIMEOUT_MS
            )
            if (!res.ok) return null
            info = await res.json() as ConsumetAnimeInfo
            if ((info.episodes?.length ?? 0) > 0) cacheSet(cacheKey, info, 30 * 60 * 1000)
        } catch {
            return null
        }
    }

    const candidateTitles = [info.title?.english, info.title?.romaji, info.title?.native].filter(
        (t): t is string => !!t
    )
    // No title in the response at all — can't validate, so don't trust it blindly.
    if (candidateTitles.length === 0) return null

    const bestScore = Math.max(...candidateTitles.map(t => titleSimilarity(t, expectedTitle)))
    if (bestScore < CONSUMET_TITLE_MIN_SCORE) return null

    const episodes = info.episodes ?? []
    return episodes.find(e => e.number === episodeNum)?.id ?? null
}

/**
 * Main Consumet entry point — returns a direct HLS/MP4 URL for a given
 * MAL ID + episode number, or null if anything in the chain fails.
 *
 * Calling convention: always wrap in .catch(() => null) at the call site so a
 * transient Consumet outage never breaks the Otakudesu fallback path.
 */
async function consumetFetchStreamUrl(malId: string, episodeNum: number, expectedTitle: string): Promise<string | null> {
    if (!CONSUMET_ENABLED) return null

    const cacheKey = `consumet-url:${malId}:${episodeNum}`
    const cached = cacheGet<string>(cacheKey)
    if (cached) return cached

    const anilistId = await anilistIdFromMalId(malId)
    if (!anilistId) return null

    const episodeId = await consumetFindEpisodeId(anilistId, episodeNum, expectedTitle)
    if (!episodeId) return null

    const res = await withTimeout(
        fetch(`${CONSUMET_BASE}/meta/anilist/watch/${encodeURIComponent(episodeId)}?provider=zoro`, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        }),
        CONSUMET_TIMEOUT_MS
    )
    if (!res.ok) return null

    const json = await res.json() as ConsumetStreamResult
    const sources = json.sources ?? []
    if (sources.length === 0) return null

    // Prefer HLS (.m3u8) over MP4; within same type, pick highest quality label
    const qualityRank = (q: string): number => {
        if (q.includes('1080')) return 5
        if (q.includes('720')) return 4
        if (q.includes('480')) return 3
        if (q.includes('360')) return 2
        return 1
    }
    const best = [...sources].sort((a, b) => {
        const hlsDiff = (b.isM3U8 ? 1 : 0) - (a.isM3U8 ? 1 : 0)
        return hlsDiff !== 0 ? hlsDiff : qualityRank(b.quality) - qualityRank(a.quality)
    })[0]

    if (!best?.url) return null
    const url = best.url.startsWith('//') ? `https:${best.url}` : best.url
    cacheSet(cacheKey, url, 5 * 60 * 1000)
    return url
}

// ─────────────────────────────────────────────────────────────────────────────
// searchBest — races all title variants + wajik API in parallel for speed
// ─────────────────────────────────────────────────────────────────────────────
// Hard cap on how many title-variant queries we'll ever fan out for a single
// search. titleVariants() emits ~6 variants per title, and extraAlts (Jikan
// alt titles) can add several more titles on top of that — past ~8 unique
// queries the marginal hit-rate is basically zero, it just multiplies
// network load against the target mirrors for no benefit.
const SEARCH_MAX_QUERIES = 8

// Wall-clock cap for the ENTIRE searchBest() call, regardless of how many
// queries are in flight. Previously, when no confident match was found in
// the first 2 queries, the function fell back to looping through every
// remaining variant ONE AT A TIME — each htmlSearch() call could take up to
// ~9s when a mirror was slow/Cloudflare-challenged, so 15-20 leftover
// variants could add 100+ seconds to a single request. Now every query runs
// in parallel and the whole function gives up waiting after this cap.
const SEARCH_TOTAL_TIMEOUT_MS = 12_000

async function searchBest(
    primary: string,
    extraAlts: string[] = [],
): Promise<Array<{ result: SearchResult; matchedQuery: string; score: number }>> {

    const allVariants = [
        ...titleVariants(primary),
        ...extraAlts.flatMap(t => titleVariants(t)),
    ]

    // Deduplicate while preserving order, then cap fan-out
    const seen = new Set<string>()
    const queries = allVariants
        .filter(q => { if (seen.has(q)) return false; seen.add(q); return true })
        .slice(0, SEARCH_MAX_QUERIES)

    // Helper to score a result against all our known titles
    const scoreResult = (result: SearchResult): number => {
        const allTitles = [primary, ...extraAlts]
        return Math.max(...allTitles.map(t => titleSimilarity(result.title, t)))
    }

    const candidatesMap = new Map<string, { result: SearchResult; matchedQuery: string; score: number }>()

    // Every query variant races wajik + HTML scrape IN PARALLEL with every
    // other query variant — no more sequential fallback loop. The outer cap
    // makes sure one stuck mirror/query can't stall the whole search.
    const perQueryOutcomes = await raceAllWithCap(
        queries.map(async query => {
            const [wajikResults, scrapeHit] = await Promise.allSettled([
                wajikSearch(query),
                htmlSearch(query),
            ])
            return { query, wajikResults, scrapeHit }
        }),
        SEARCH_TOTAL_TIMEOUT_MS
    )

    for (const outcome of perQueryOutcomes) {
        if (!outcome) continue
        const { query, wajikResults, scrapeHit } = outcome

        if (wajikResults.status === 'fulfilled' && wajikResults.value) {
            for (const r of wajikResults.value) {
                const score = scoreResult(r)
                const key = r.url
                if (!candidatesMap.has(key) || (candidatesMap.get(key)?.score ?? 0) < score) {
                    candidatesMap.set(key, { result: r, matchedQuery: query, score })
                }
            }
        }
        if (scrapeHit.status === 'fulfilled' && scrapeHit.value?.results.length) {
            for (const r of scrapeHit.value.results) {
                const score = scoreResult(r)
                const key = r.url
                if (!candidatesMap.has(key) || (candidatesMap.get(key)?.score ?? 0) < score) {
                    candidatesMap.set(key, { result: r, matchedQuery: query, score })
                }
            }
        }
    }

    // Sort descending by score
    return [...candidatesMap.values()].sort((a, b) => b.score - a.score)
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveEpisodeList — tries wajik API first, then falls back to HTML scraping
// ─────────────────────────────────────────────────────────────────────────────
async function wajikEpisodes(animeUrl: string): Promise<EpisodeEntry[] | null> {
    // Extract animeId from URL slug (e.g. "one-piece-sub-indo" → animeId)
    const slug = extractSlug(animeUrl)
    if (!slug) return null

    try {
        const res = await withTimeout(
            fetch(`https://wajik-anime-api.vercel.app/otakudesu/anime/${slug}`, {
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            }),
            5_000
        )
        if (!res.ok) return null
        const json = await res.json() as any
        const episodeList: any[] = json?.data?.episodeList ?? []
        if (!Array.isArray(episodeList) || episodeList.length === 0) return null

        const episodes: EpisodeEntry[] = episodeList
            .map((ep: any) => {
                const title = ep.episodeTitle ?? ep.title ?? ''
                const url = ep.url ?? ep.episodeUrl ?? ''
                const rawText = typeof ep === 'object' ? JSON.stringify(ep) : String(ep ?? '')
                return {
                    episode: parseEpisodeNumber(title, url),
                    title,
                    url,
                    rawText,
                }
            })
            .filter((e: EpisodeEntry & { rawText?: string }) =>
                e.url
                && !isComingSoonEpisode(e.title, e.url, e.rawText ?? '')
                && !/pembatas|dalam proses/i.test(e.title)
            )
            .map(({ rawText: _rawText, ...ep }) => ep)

        if (episodes.length === 0) return null

        // Sort ASC
        episodes.sort((a, b) => {
            if (a.episode < 0 && b.episode < 0) return 0
            if (a.episode < 0) return 1
            if (b.episode < 0) return -1
            return a.episode - b.episode
        })
        return episodes
    } catch {
        return null
    }
}

async function resolveEpisodeList(animeUrl: string): Promise<EpisodeEntry[]> {
    const slug = extractSlug(animeUrl)
    const cacheKey = `episodes:${slug}`
    const infoCacheKey = `animeInfo:${slug}`
    const cached = cacheGet<EpisodeEntry[]>(cacheKey)
    if (cached) return cached

    // Run wajik API and HTML scraping CONCURRENTLY instead of sequentially.
    // Previously wajik's up-to-5s timeout was fully awaited BEFORE the HTML
    // scrape (which can itself take up to ~9s: 4s direct fetch + 5s DNS-bypass
    // fallback) even started — stacking to ~14s worst case for a single
    // candidate. That blows past EPISODE_RESOLVE_PASS_TIMEOUT_MS (12s), which
    // resolveFirstWithEpisodes() uses to cap the whole batch of candidates,
    // so a slow/cold-starting wajik instance could silently zero out an
    // otherwise-successful HTML scrape. Running them in parallel caps the
    // worst case at max(wajik_time, scrape_time) (~9s) instead of the sum.
    const [wajikOutcome, scrapeOutcome] = await Promise.allSettled([
        wajikEpisodes(animeUrl),
        scrapeHtml(animeUrl),
    ])

    // Side effect: scrapeHtml(animeUrl) di atas selalu jalan (baik wajik-nya
    // sukses atau nggak — Promise.allSettled nunggu keduanya), jadi HTML
    // detail page-nya udah ada di tangan tanpa perlu fetch baru. Sekalian aja
    // parse & cache info anime (title/poster/sinopsis/dll) di sini, biar
    // resolveAnimeInfo() nanti (dipanggil abis ini, atau dari endpoint
    // terpisah) tinggal baca dari cache — nol fetch tambahan di jalur normal.
    if (scrapeOutcome.status === 'fulfilled') {
        try {
            const info = parseAnimeInfo(scrapeOutcome.value.html, scrapeOutcome.value.base)
            if (info) cacheSet(infoCacheKey, info, 30 * 60 * 1000)
        } catch {
            // parseAnimeInfo() masih best-guess (belum diverifikasi live) —
            // gagal di sini gak boleh numbangin resolveEpisodeList() yang
            // udah kebukti jalan.
        }
    }

    const wajikEps = wajikOutcome.status === 'fulfilled' ? wajikOutcome.value : null
    if (wajikEps && wajikEps.length > 0) {
        cacheSet(cacheKey, wajikEps, 15 * 60 * 1000)
        return wajikEps
    }

    if (scrapeOutcome.status === 'fulfilled') {
        const { html, base } = scrapeOutcome.value
        const episodes = parseEpisodes(html, base)
        if (episodes.length > 0) cacheSet(cacheKey, episodes, 15 * 60 * 1000)
        return episodes
    }

    return []
}

/**
 * Ambil metadata detail anime (title/poster/sinopsis/genre/status/studio).
 * Nebeng scrape yang udah/bakal dilakukan resolveEpisodeList() — kalau cache
 * animeInfo udah keisi (dari pemanggilan endpoint episodes/stream/download
 * sebelumnya buat anime yang sama), fungsi ini gak fetch apa-apa sama sekali.
 * Kalau belum, dia trigger resolveEpisodeList() (yang scrape-nya ngisi cache
 * sebagai side effect di atas) lalu baca ulang dari cache — tetap cuma SATU
 * scrapeHtml() call, walaupun caller cuma butuh info-nya doang tanpa peduli
 * episode list.
 */
async function resolveAnimeInfo(animeUrl: string): Promise<AnimeInfo | null> {
    const infoCacheKey = `animeInfo:${extractSlug(animeUrl)}`

    const cached = cacheGet<AnimeInfo>(infoCacheKey)
    if (cached) return cached

    await resolveEpisodeList(animeUrl)

    return cacheGet<AnimeInfo>(infoCacheKey)
}

// Cap how many candidate hits get tried per pass and how long a whole pass
// is allowed to take.
const EPISODE_CANDIDATES_PER_PASS = 5
const EPISODE_RESOLVE_PASS_TIMEOUT_MS = 12_000

/**
 * Tries resolveEpisodeList() for several candidate search hits IN PARALLEL
 * (capped), then returns the first one — in original score-desc order —
 * that actually has episodes. This replaces the old behaviour of awaiting
 * resolveEpisodeList() for one hit at a time: each failed attempt could cost
 * up to ~14s (5s wajik timeout + ~9s HTML scrape fallback), and with several
 * hits to try that added up fast. Now a whole batch costs at most
 * EPISODE_RESOLVE_PASS_TIMEOUT_MS regardless of how many candidates it has.
 */
async function resolveFirstWithEpisodes(
    candidateHits: Array<{ result: SearchResult; matchedQuery: string; score: number }>,
    maxEpisode: number | null,
    episodeNum: number,
): Promise<{ episodes: EpisodeEntry[]; matchedHit: { result: SearchResult; matchedQuery: string; score: number } } | null> {
    const batch = candidateHits.slice(0, EPISODE_CANDIDATES_PER_PASS)
    if (batch.length === 0) return null

    const settled = await raceAllWithCap(
        batch.map(async hit => ({
            hit,
            episodes: filterByMaxEpisode(await resolveEpisodeList(hit.result.url), maxEpisode),
        })),
        EPISODE_RESOLVE_PASS_TIMEOUT_MS
    )

    const usable = settled.filter((o): o is { hit: typeof batch[0]; episodes: EpisodeEntry[] } =>
        o !== undefined && o.episodes.length > 0
    )
    if (usable.length === 0) return null

    // Ultra-long-running shows (One Piece, Detective Conan, etc.) almost
    // always end up split across several Otakudesu posts by arc/year, all
    // matching the same franchise title with an equal similarity score.
    // Picking "whichever resolved first" (the old behaviour) could lock onto
    // a completely unrelated arc-post — episode 1071 silently falling back
    // to that post's nearest episode (e.g. its own ep 130), which is a
    // different story arc entirely, not actually a missing-episode case.
    // Prefer whichever candidate's list genuinely contains the requested
    // episode number first.
    //
    // CAVEAT — movies / first episodes (episodeNum <= 1): "does episode N
    // exist" is a USELESS signal here, because virtually every anime on
    // Otakudesu/Sokuja has an "episode 1". Without a score gate this used to
    // hand back completely unrelated titles for movies — e.g. searching
    // "Koe no Katachi" and getting whatever weakly-matched, low-score title
    // happened to resolve into `usable` first, since it trivially "covers"
    // episode 1 too. So for this range we additionally require a decent
    // title-similarity score before trusting the coverage check.
    const LOW_CONFIDENCE_EPISODE_MIN_SCORE = 0.5
    const isLowConfidenceEpisode = episodeNum <= 1
    const exactCoverage = usable.find(o =>
        o.episodes.some(ep => ep.episode === episodeNum) &&
        (!isLowConfidenceEpisode || o.hit.score >= LOW_CONFIDENCE_EPISODE_MIN_SCORE)
    )
    if (exactCoverage) return { episodes: exactCoverage.episodes, matchedHit: exactCoverage.hit }

    // Movies/ep1 with no confident coverage match: "closest episode number"
    // is equally meaningless here (every candidate is 0-1 away from what we
    // asked for), so fall back to whichever candidate has the best title
    // match instead of the fastest-to-resolve one.
    if (isLowConfidenceEpisode) {
        const bestByScore = usable.reduce((best, o) => o.hit.score > best.hit.score ? o : best)
        return { episodes: bestByScore.episodes, matchedHit: bestByScore.hit }
    }

    // None of them cover it exactly — fall back to whichever candidate's
    // episode range is numerically CLOSEST to what was requested, rather
    // than just the fastest-to-resolve one.
    const closest = usable.reduce((best, o) => {
        const bestDist = Math.min(...best.episodes.map(ep => Math.abs(ep.episode - episodeNum)))
        const oDist = Math.min(...o.episodes.map(ep => Math.abs(ep.episode - episodeNum)))
        return oDist < bestDist ? o : best
    })
    return { episodes: closest.episodes, matchedHit: closest.hit }
}

// ─────────────────────────────────────────────────────────────────────────────
// extractDirectVideoUrl — best-effort extraction of a direct .mp4 / .m3u8
// from an iframe embed page so the player can render ad-free via <video>.
// Falls back gracefully to null on any error so the caller can use the iframe.
// ─────────────────────────────────────────────────────────────────────────────
const VIDEO_EXT_RE = /\.(mp4|m3u8|webm|ts)([?#][^\s"']*)?($)/i
const STATIC_ASSET_RE = /\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)(?:[?#]|$)/i

// JS variable patterns — ordered from most-specific (has video extension) to generic
const JS_VIDEO_PATTERNS: RegExp[] = [
    // file / source / src / url pointing to video extension
    /(?:file|source|src|url|videoSrc|videoUrl|hls)\s*[:=]\s*["'`]((?:https?:)?\/\/[^"'`\s]+\.(?:mp4|m3u8|webm|ts)[^"'`\s]*)["'`]/i,
    // JWPlayer-style sources array: { file: "..." }
    /sources\s*:\s*\[[\s\S]{0,200}?file\s*:\s*["'`]((?:https?:)?\/\/[^"'`\s]+)["'`]/i,
    // HLS.js: hls.loadSource("...") or Plyr / Video.js source URL
    /(?:loadSource|attachMedia)\s*\(\s*["'`]((?:https?:)?\/\/[^"'`\s]+\.m3u8[^"'`\s]*)["'`]/i,
    // Generic fallback: any http(s) var assignment that looks like a video
    /(?:file|source|src|videoUrl)\s*[:=]\s*["'`](https?:\/\/[^"'`\s]{10,})["'`]/i,
]

async function extractDirectVideoUrl(iframeSrc: string, referer?: string): Promise<string | null> {
    try {
        if (VIDEO_EXT_RE.test(iframeSrc)) return iframeSrc

        const parsed = new URL(iframeSrc)
        const origin = parsed.origin

        const res = await withTimeout(
            fetchWithDns(iframeSrc, {
                headers: {
                    ...HTML_HDRS,
                    Referer: referer ?? origin,
                    Origin: origin,
                    'Sec-Fetch-Dest': 'iframe',
                    'Sec-Fetch-Mode': 'navigate',
                },
                cache: 'no-store',
            }),
            6_000
        )
        if (!res.ok) return null

        const html = await res.text()
        if (!html || html.length < 100) return null

        // ── 1. <source src> / <video src> / <source data-src> ────────────────
        const $ = cheerio.load(html)
        const tagSrc =
            $('source[src]').attr('src') ??
            $('video[src]').attr('src') ??
            $('source[data-src]').attr('data-src') ??
            null
        if (tagSrc) {
            const url = tagSrc.startsWith('//') ? `https:${tagSrc}` : tagSrc
            if (VIDEO_EXT_RE.test(url)) return url
        }

        // ── 2. Inline <script> blocks ─────────────────────────────────────────
        const scriptTexts: string[] = []
        $('script').each((_, el) => {
            if ($(el).attr('src')) return           // skip external scripts
            const text = $(el).html() ?? ''
            if (text.trim()) scriptTexts.push(text)
        })

        for (const scriptText of scriptTexts) {
            for (const pattern of JS_VIDEO_PATTERNS) {
                const match = scriptText.match(pattern)
                if (match?.[1]) {
                    let url = match[1]
                    if (url.startsWith('//')) url = `https:${url}`
                    if (
                        url.startsWith('http') &&
                        !STATIC_ASSET_RE.test(url) &&
                        // generic pattern needs video ext confirmation
                        (VIDEO_EXT_RE.test(url) || !pattern.source.includes('videoUrl'))
                    ) {
                        return url
                    }
                }
            }
        }

        // ── 3. Raw HTML scan — last resort ────────────────────────────────────
        // Only matches URLs that explicitly contain a video extension, so we
        // don't accidentally return JS/CSS asset URLs.
        const rawMatch = html.match(
            /["'`]((?:https?:)?\/\/[^\s"'`]+\.(?:mp4|m3u8|webm|ts)(?:[?#][^\s"'`]*)?)["'`]/
        )
        if (rawMatch?.[1]) {
            const url = rawMatch[1].startsWith('//') ? `https:${rawMatch[1]}` : rawMatch[1]
            return url
        }

        return null
    } catch {
        return null
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveStreamForEpisode — HTML scraping only (WP REST API requires auth)
// Mirrors are raced in parallel for speed
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_HOSTS = [
    'desustream', 'streamlare', 'streamtape', 'doodstream',
    'filemoon', 'vidstream', 'mycloud', 'mp4upload',
    'lylith', 'uservideo', 'gogoplay', 'animefever',
]

const STREAM_HOST_SCORE: Record<string, number> = {
    desustream: 100,
    mp4upload: 90,
    lylith: 80,
    uservideo: 75,
    vidstream: 70,
    mycloud: 65,
    gogoplay: 60,
    animefever: 55,
    streamlare: 50,
    filemoon: 5,
    streamtape: 0,
    doodstream: 0,
    dood: 0,
}

// Minimum host score for a mirror to be considered "extractable". Hosts scoring
// below this (streamtape, doodstream, dood) rely on client-side JS obfuscation or
// token-gated redirects that extractDirectVideoUrl cannot crack server-side.
// Including them in the race wastes up to 6 s of timeout budget per candidate
// and is guaranteed to produce a null result.
const EXTRACTABLE_HOST_SCORE_MIN = 1

// Hard wall-clock cap for the parallel direct-URL extraction race.
// Individual candidates each carry a 6 s timeout inside extractDirectVideoUrl;
// this outer cap prevents Promise.any from stalling the response if multiple
// slow-but-alive mirrors all consume their full per-candidate budgets in parallel.
const RACE_EXTRACTION_TIMEOUT_MS = 12_000

function safeHostname(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return '' }
}

function getHostScore(...parts: Array<string | undefined | null>): number {
    const haystack = parts.filter(Boolean).join(' ').toLowerCase()
    for (const [host, score] of Object.entries(STREAM_HOST_SCORE)) {
        if (haystack.includes(host)) return score
    }
    // Unknown hosts are not automatically bad. Some mirrors are direct/CDN-ish
    // and easier than filemoon/streamtape, so give them a middle fallback score.
    return 30
}

function getQualityScore(...parts: Array<string | undefined | null>): number {
    const haystack = parts.filter(Boolean).join(' ').toLowerCase()
    const match = haystack.match(/\b(1080|720|480|360|240)p\b/)
    if (!match) return 0
    const q = Number(match[1])
    if (q >= 1080) return 35
    if (q >= 720) return 30
    if (q >= 480) return 20
    if (q >= 360) return 10
    return 5
}

// Numeric resolution a mirror declared (720/480/360/...), independent of the
// 0-35 getQualityScore() scale above — this one's for exact-match comparison
// against a user-requested preferredQuality, not for general ranking.
function parseQualityNumber(...parts: Array<string | undefined | null>): number | null {
    const haystack = parts.filter(Boolean).join(' ').toLowerCase()
    const match = haystack.match(/\b(1080|720|480|360|240)p?\b/)
    return match ? Number(match[1]) : null
}

function scoreResolvedMirror(mirror: MirrorOption, iframe: string): ResolvedMirrorCandidate {
    const host = safeHostname(iframe)
    const hostScore = getHostScore(host, iframe, mirror.label, mirror.quality)
    const qualityScore = getQualityScore(mirror.quality, mirror.label, iframe)
    const declaredQuality = parseQualityNumber(mirror.quality, mirror.label)
    return {
        mirror,
        iframe,
        host,
        hostScore,
        qualityScore,
        score: hostScore * 100 + qualityScore,
        declaredQuality,
    }
}

// Sort comparator factory — when preferredQuality is given, candidates whose
// declaredQuality exactly matches it are bubbled to the very top, ahead of
// hostScore entirely. Without this, a request for "720p" would still lose to
// any higher-hostScore mirror at 360p, because hostScore was always compared
// first regardless of what quality the user actually asked for.
function createMirrorComparator(preferredQuality?: number | null) {
    return (a: ResolvedMirrorCandidate, b: ResolvedMirrorCandidate): number => {
        if (preferredQuality) {
            const aMatch = a.declaredQuality === preferredQuality ? 1 : 0
            const bMatch = b.declaredQuality === preferredQuality ? 1 : 0
            if (aMatch !== bMatch) return bMatch - aMatch
        }
        if (b.hostScore !== a.hostScore) return b.hostScore - a.hostScore
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore
        return b.score - a.score
    }
}

// Note: there's no more standalone default-comparator const — both call
// sites below call createMirrorComparator(preferredQuality) directly, since
// preferredQuality may be null/undefined which createMirrorComparator
// already treats identically to "no preference, sort by hostScore only".

// Hard wall-clock cap for resolving mirror candidates (nonce fetch + AJAX
// embed call per mirror, each individually allowed up to 8s). Previously
// this used Promise.allSettled, which waits for literally every mirror to
// finish — so one slow/dead mirror's nonce timeout could add up to ~16s on
// top of however long the others took. Capping it means we move on with
// whichever mirrors answered in time.
const MIRROR_RESOLVE_CAP_MS = 10_000

async function resolveMirrorCandidates(
    mirrors: MirrorOption[],
    episodeUrl: string,
    sourceMirror?: string,
    preferredQuality?: number | null,
): Promise<ResolvedMirrorCandidate[]> {
    const settled = await raceAllWithCap(
        mirrors.map(async mirror => {
            const iframe = await resolveMirrorUrl(mirror, episodeUrl, sourceMirror)
            if (!iframe) throw new Error('no-iframe')
            return scoreResolvedMirror(mirror, iframe)
        }),
        MIRROR_RESOLVE_CAP_MS
    )

    return settled
        .filter((v): v is ResolvedMirrorCandidate => v !== undefined)
        .sort(createMirrorComparator(preferredQuality))
}

interface DirectVideoRaceResult {
    hit: DirectVideoHit | null
    // Iframes we just confirmed are currently unreachable/broken (e.g. desustream
    // returning a Cloudflare 526 because its origin's SSL cert is bad right now).
    // Callers must NOT fall back to one of these as a "good enough" iframe —
    // hostScore alone doesn't know a host is down, so without this the caller
    // would just keep re-picking the same dead host every time.
    failedIframes: Set<string>
}

async function raceDirectVideoFromCandidates(
    candidates: ResolvedMirrorCandidate[],
    episodeUrl: string,
    preferredQuality?: number | null,
): Promise<DirectVideoRaceResult> {
    // Only race candidates from extractable hosts. Score-0 hosts (streamtape,
    // doodstream, dood) use client-side JS obfuscation / token gates that
    // server-side scraping cannot penetrate — including them in the race is
    // guaranteed to produce null while burning the full per-candidate timeout.
    const extractable = candidates
        .filter(c => c.hostScore >= EXTRACTABLE_HOST_SCORE_MIN)
        .sort(createMirrorComparator(preferredQuality))
        .slice(0, 3)

    if (extractable.length === 0) return { hit: null, failedIframes: new Set() }

    // Promise.any only tells you the FIRST winner, not which of the losers
    // actually failed vs simply lost the race — so we can't tell "dead host"
    // apart from "slightly slower host" from it. Promise.allSettled (still run
    // fully in parallel, same as before) lets us see every individual outcome
    // so a confirmed-dead candidate can be excluded from the iframe fallback too.
    let settled: PromiseSettledResult<string | null>[]
    try {
        settled = await withTimeout(
            Promise.allSettled(extractable.map(c => extractDirectVideoUrl(c.iframe, episodeUrl))),
            RACE_EXTRACTION_TIMEOUT_MS
        )
    } catch {
        // Outer wall-clock cap fired before allSettled resolved — treat every
        // candidate as unresolved rather than throwing the whole stream away.
        settled = extractable.map(() => ({ status: 'rejected', reason: 'timeout' }))
    }

    const failedIframes = new Set<string>()
    let hit: DirectVideoHit | null = null

    extractable.forEach((candidate, i) => {
        const outcome = settled[i]
        const directUrl = outcome?.status === 'fulfilled' ? outcome.value : null
        if (directUrl && !hit) {
            hit = { iframe: candidate.iframe, directUrl }
        } else if (!directUrl) {
            failedIframes.add(candidate.iframe)
        }
    })

    return { hit, failedIframes }
}

async function resolveStreamForEpisode(
    episodeUrl: string,
    preferredQuality?: number | null,
): Promise<StreamResult> {
    const cacheKey = `stream:${extractSlug(episodeUrl)}:${preferredQuality ?? 'auto'}`
    const cached = cacheGet<StreamResult>(cacheKey)
    if (cached) return cached

    let mirrors: MirrorOption[] = []
    let contentHtml = ''
    let sourceMirror: string | undefined

    // Go directly to HTML scraping
    try {
        const scrape = await scrapeHtml(episodeUrl)
        contentHtml = scrape.html
        mirrors = parseMirrors(contentHtml)
        sourceMirror = scrape.base
    } catch { }

    let iframe: string | null = null
    let directUrl: string | null = null
    let resolved = false
    let availableQualities: number[] = []

    if (mirrors.length > 0) {
        // Resolve ALL mirrors first. The old flow only extracted directUrl from
        // the first "winner", which could be streamtape/filemoon and therefore
        // basically an ad/obfuscated swamp. Humanity survived worse, but barely.
        const resolvedCandidates = await resolveMirrorCandidates(mirrors, episodeUrl, sourceMirror, preferredQuality)

        availableQualities = [...new Set(
            resolvedCandidates.map(c => c.declaredQuality).filter((q): q is number => q !== null)
        )].sort((a, b) => b - a)

        if (resolvedCandidates.length > 0) {
            const { hit: directHit, failedIframes } = await raceDirectVideoFromCandidates(resolvedCandidates, episodeUrl, preferredQuality)
            if (directHit) {
                iframe = directHit.iframe
                directUrl = directHit.directUrl
            } else {
                // Every extractable host we just tried (desustream, score 100,
                // usually wins this) came back dead — e.g. a Cloudflare 526
                // because its origin's SSL cert is currently broken. Falling
                // back to resolvedCandidates[0] here would just hand the
                // browser that exact same dead host again, since hostScore is
                // a static string-match and has no idea it's down right now.
                // Skip anything we just confirmed failed and use the next-best
                // candidate that's actually still alive (even a lower-scored,
                // ad-having host like streamtape beats an iframe that won't
                // load at all).
                const fallback = resolvedCandidates.find(c => !failedIframes.has(c.iframe)) ?? resolvedCandidates[0]
                iframe = fallback.iframe
            }
            resolved = true
        }
    }

    // Fallback 1: select option Base64 decodes (Animestream / Tsun theme mirror option format)
    if (!iframe && contentHtml) {
        const $ = cheerio.load(contentHtml)
        $('select option, .mirror select option').each((_, el) => {
            if (iframe) return
            const val = $(el).attr('value') ?? ''
            if (val.length > 20) {
                try {
                    const decoded = Buffer.from(val, 'base64').toString('utf-8')
                    const $decoded = cheerio.load(decoded)
                    const src = ($decoded('iframe').attr('src') ?? $decoded('iframe').attr('data-src') ?? '').trim()
                    if (src.startsWith('http')) iframe = src
                } catch { }
            }
        })
        if (iframe) resolved = true
    }

    // Fallback 2: direct iframe from content
    if (!iframe && contentHtml) {
        const $ = cheerio.load(contentHtml)
        $('iframe').each((_, el) => {
            if (iframe) return
            const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim()
            if (src.startsWith('http')) iframe = src
        })
        if (iframe) resolved = true
    }

    // Fallback 2b: data-video / data-content / data-url attributes on any element
    // (some Otakudesu mirror themes embed the player URL as a data attribute
    // on a div/button rather than an <iframe src>)
    if (!iframe && contentHtml) {
        const $ = cheerio.load(contentHtml)
        const dataAttrs = ['data-video', 'data-content', 'data-url', 'data-embed', 'data-player']
        $('[data-video], [data-content], [data-url], [data-embed], [data-player]').each((_, el) => {
            if (iframe) return
            for (const attr of dataAttrs) {
                const raw = ($(el).attr(attr) ?? '').trim()
                if (!raw) continue

                // Value may itself be an http(s) URL
                if (raw.startsWith('http')) {
                    iframe = raw
                    break
                }

                // Or it may be a base64-encoded blob containing an <iframe>/src
                if (raw.length > 20 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
                    try {
                        const decoded = Buffer.from(raw, 'base64').toString('utf-8')
                        if (decoded.startsWith('http')) {
                            iframe = decoded
                            break
                        }
                        const $decoded = cheerio.load(decoded)
                        const src = ($decoded('iframe').attr('src') ?? $decoded('iframe').attr('data-src') ?? '').trim()
                        if (src.startsWith('http')) {
                            iframe = src
                            break
                        }
                    } catch { }
                }
            }
        })
        if (iframe) resolved = true
    }

    // Fallback 2c: stream URL embedded directly inside a <script> block's JS code,
    // e.g. var settings = { file: "https://..." } or videoSrc = "https://..."
    // or jwplayer setup({ sources: [{ file: "..." }] })
    //
    // IMPORTANT: only scan text *inside* <script>...</script> tags — NOT the
    // full contentHtml — otherwise patterns like src="..." also match
    // <script src="https://cdn.../jquery.min.js"> tags (static assets), and
    // we'd end up loading a .js file as the "video" iframe.
    if (!iframe && contentHtml) {
        const $ = cheerio.load(contentHtml)
        const scriptTexts: string[] = []
        $('script').each((_, el) => {
            const src = ($(el).attr('src') ?? '').trim()
            // Skip external <script src="..."> tags entirely — we only want
            // inline scripts that may contain the player config.
            if (src) return
            const text = $(el).html() ?? ''
            if (text.trim()) scriptTexts.push(text)
        })

        const STATIC_ASSET_EXT = /\.(?:js|css|png|jpe?g|gif|svg|webp|woff2?|ttf)(?:[?#]|$)/i

        const jsUrlPatterns = [
            /(?:file|source|src|url|videoSrc|videoUrl)\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)["']/i,
            /(?:file|source|src|url|videoSrc|videoUrl)\s*[:=]\s*["'](https?:\/\/[^"'\s]+)["']/i,
        ]

        for (const scriptText of scriptTexts) {
            if (iframe) break
            for (const pattern of jsUrlPatterns) {
                const match = scriptText.match(pattern)
                if (match?.[1]) {
                    let url = match[1]
                    if (url.startsWith('//')) url = `https:${url}`
                    if (url.startsWith('http') && !STATIC_ASSET_EXT.test(url)) {
                        iframe = url
                        break
                    }
                }
            }
        }
        if (iframe) resolved = true
    }

    // Fallback 3: Known host scan — last resort
    if (!iframe && contentHtml) {
        const $ = cheerio.load(contentHtml)
        $('iframe, source').each((_, el) => {
            if (iframe) return
            const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim()
            if (KNOWN_HOSTS.some(h => src.includes(h))) iframe = src
        })
        if (iframe) resolved = true
    }

    // Last-resort: if mirror ranking produced no directUrl but we have a fallback
    // iframe, attempt one extraction pass — but ONLY when the iframe host is not
    // known to be obfuscated / token-gated. Calling extractDirectVideoUrl against
    // a streamtape or doodstream URL is guaranteed to return null after burning
    // the full 6 s per-candidate timeout budget; never worth attempting.
    if (iframe && !directUrl && getHostScore(iframe) >= EXTRACTABLE_HOST_SCORE_MIN) {
        directUrl = await extractDirectVideoUrl(iframe, episodeUrl)
    }

    const result: StreamResult = { iframe, directUrl, mirrors, resolved, availableQualities }
    if (resolved) cacheSet(cacheKey, result, 5 * 60 * 1000)
    return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Multi-source layer — NontonAnimeID adapter + sticky source orchestrator
// ═══════════════════════════════════════════════════════════════════════════
//
// NontonAnimeID runs on a DIFFERENT WordPress anime theme than Otakudesu —
// no `.mirrorstream` + base64 `data-content` blobs. Confirmed from a live
// fetch (24 Jun 2026) of nontonanimeid.my.id:
//   - Anime detail page: {base}/anime/{slug}/
//   - Episode page:      {base}/{episode-slug}/   (flat, NOT nested under /anime/)
//   - Episode page lists every sibling episode near the bottom as plain <a>
//     links with text like "... Eps 52 END - Juni 24, 2026" — parseEpisodeNumber()
//     already understands the "eps NN" pattern (it's in its regex alternation),
//     so it's reused as-is in nontonEpisodes() below instead of writing a 2nd parser.
//   - Player area shows "Select Video Server" → "Server 720p" / "Server 480p"
//     (quality is given directly in the label, no guessing needed) and a raw
//     .mp4 CDN URL was already present in the rendered page WITHOUT clicking
//     anything — strongly suggesting the default server's source is inline
//     (a <video><source src> tag or a JS player-config object), not an
//     AJAX-gated iframe like Otakudesu's mirrors.
//
// What's UNVERIFIED and may need adjusting once tested against the live site
// (this was reverse-engineered from extracted/rendered text, not raw HTML —
// my sandbox got bot-blocked fetching some of the candidate domains directly):
//   - Exact tag/attribute the inline source sits in — nontonExtractInlineSources()
//     below scans both <video>/<source> tags and inline <script> player-config
//     text, same "file:/source:/src:" pattern Otakudesu's own resolveStreamForEpisode
//     already uses as its Fallback 2c.
//   - Whether "Server 480p"/"Server 720p" tabs are pre-rendered (covered by the
//     scan above) or load via a 2nd AJAX call. No AJAX path is implemented for
//     this yet — if the inline scan comes up empty on a real episode, that's
//     the next thing to add here.
//   - Search result markup (nontonSearch() below matches on `href*="/anime/"`
//     rather than a CSS class, since the URL shape IS confirmed from a live
//     fetch and is far more resilient to theme styling than a guessed class).
//
// 👉 To verify/fix any of the above, add a debug branch the same way the
// existing `endpoint === 'debug'` one works for Otakudesu — point it at a
// NontonAnimeID episode URL and inspect the raw HTML. Whatever's off here is
// a 1-function fix, not a redesign.
const NONTON_MIRRORS: readonly string[] = [
    process.env.ANIME_INDO_NONTON_BASE ?? 'https://nontonanimeid.my.id',
    'https://s13.nontonanimeid.boats', // domain rotasi alternatif — situs ini juga sering ganti domain
]

async function nontonFetchHtml(url: string): Promise<string> {
    return fetchSingleUrl(url)
}

async function nontonSearch(query: string): Promise<SearchResult[]> {
    const cacheKey = `nonton-search:${query.toLowerCase()}`
    const cached = cacheGet<SearchResult[]>(cacheKey)
    if (cached) return cached

    for (const base of NONTON_MIRRORS) {
        try {
            const html = await nontonFetchHtml(`${base}/?s=${encodeURIComponent(query)}`)
            const $ = cheerio.load(html)
            const seen = new Set<string>()
            const results: SearchResult[] = []

            $('a[href*="/anime/"]').each((_, el) => {
                const a = $(el)
                const rawHref = (a.attr('href') ?? '').split('?')[0]
                const href = rawHref.replace(/\/$/, '') + '/'
                if (!/\/anime\/[^/]+\/$/.test(href) || seen.has(href)) return

                const title = (a.attr('title') || a.text().trim() || a.find('img').attr('alt') || '').trim()
                if (!title) return

                seen.add(href)
                const thumb = a.find('img').attr('src') ?? a.find('img').attr('data-src') ?? ''
                results.push({ title, url: href, thumb })
            })

            if (results.length > 0) {
                cacheSet(cacheKey, results, 10 * 60 * 1000)
                return results
            }
        } catch { /* coba mirror berikutnya */ }
    }
    return []
}

async function nontonEpisodes(animeUrl: string): Promise<EpisodeEntry[]> {
    const cacheKey = `nonton-episodes:${extractSlug(animeUrl)}`
    const cached = cacheGet<EpisodeEntry[]>(cacheKey)
    if (cached) return cached

    let html: string
    try {
        html = await nontonFetchHtml(animeUrl)
    } catch {
        return []
    }

    const $ = cheerio.load(html)
    const base = new URL(animeUrl).origin
    const normalizedAnimeUrl = animeUrl.replace(/\/$/, '')
    const entries: EpisodeEntry[] = []
    const seen = new Set<string>()

    $(`a[href^="${base}"]`).each((_, el) => {
        const a = $(el)
        const href = (a.attr('href') ?? '').trim()
        if (!href || seen.has(href)) return
        if (/\/(anime|genres|studio|network|season|country|az-lists|author|page)\//.test(href)) return
        if (href.replace(/\/$/, '') === normalizedAnimeUrl) return

        const text = a.text().trim()
        if (!/\beps?\b|\bepisode\b/i.test(text)) return

        seen.add(href)
        entries.push({ episode: parseEpisodeNumber(text, href), title: text, url: href })
    })

    entries.sort((a, b) => a.episode - b.episode)
    if (entries.length > 0) cacheSet(cacheKey, entries, 10 * 60 * 1000)
    return entries
}

interface NontonInlineSource { url: string; quality: number | null }

function nontonExtractInlineSources(html: string): NontonInlineSource[] {
    const $ = cheerio.load(html)
    const found: NontonInlineSource[] = []

    const pushIfVideo = (url: string, ctxText: string) => {
        if (!url || !/\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url)) return
        found.push({ url, quality: parseQualityNumber(ctxText) })
    }

    // 1) Plain <video>/<source> tags — pakai teks div pembungkus terdekat
    // sebagai konteks buat nebak label kualitasnya ("Server 720p", dst).
    $('video source, video').each((_, el) => {
        const src = ($(el).attr('src') ?? '').trim()
        if (src) pushIfVideo(src, $(el).closest('div,section').text())
    })

    // 2) Inline <script> player-config — pola yang sama dipakai di
    // resolveStreamForEpisode's Fallback 2c buat Otakudesu, di sini dipakai
    // ulang karena themenya beda tapi konvensi player JS-nya sering serupa.
    $('script').each((_, el) => {
        if ($(el).attr('src')) return // script eksternal, skip
        const text = $(el).html() ?? ''
        const matches = text.matchAll(/(?:file|source|src)\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+\.(?:mp4|m3u8)[^"'\s]*)["']/gi)
        for (const m of matches) {
            let url = m[1]
            if (url.startsWith('//')) url = `https:${url}`
            const idx = text.indexOf(m[0])
            const around = text.slice(Math.max(0, idx - 80), idx) // konteks sebelum match buat nebak label kualitas
            pushIfVideo(url, around)
        }
    })

    return found
}

async function nontonResolveStream(
    episodeUrl: string,
    preferredQuality?: number | null,
): Promise<StreamResult> {
    const cacheKey = `nonton-stream:${extractSlug(episodeUrl)}:${preferredQuality ?? 'auto'}`
    const cached = cacheGet<StreamResult>(cacheKey)
    if (cached) return cached

    let html: string
    try {
        html = await nontonFetchHtml(episodeUrl)
    } catch {
        return { iframe: null, directUrl: null, mirrors: [], resolved: false, availableQualities: [] }
    }

    const inline = nontonExtractInlineSources(html)
    const availableQualities = [...new Set(
        inline.map(s => s.quality).filter((q): q is number => q !== null)
    )].sort((a, b) => b - a)

    let directUrl: string | null = null
    let iframe: string | null = null

    if (inline.length > 0) {
        const sorted = [...inline].sort((a, b) => {
            if (preferredQuality) {
                const aMatch = a.quality === preferredQuality ? 1 : 0
                const bMatch = b.quality === preferredQuality ? 1 : 0
                if (aMatch !== bMatch) return bMatch - aMatch
            }
            return (b.quality ?? 0) - (a.quality ?? 0)
        })
        directUrl = sorted[0].url
    }

    // Fallback: <iframe> embed generik — buat kasus server-nya ternyata embed
    // pihak ketiga (bukan mp4/m3u8 inline). HANYA dipakai sebagai INPUT buat
    // ekstraksi directUrl, BUKAN dikembalikan mentah-mentah kalau ekstraksinya
    // gagal — beda sama Otakudesu yang host embed-nya udah dikenal lewat
    // KNOWN_HOSTS/STREAM_HOST_SCORE (jadi "aman" dijadiin fallback terakhir),
    // host embed NontonAnimeID belum diverifikasi bersih dari iklan apa nggak.
    // Kalau ekstraksi gagal, ditandai unresolved aja → resolveStreamMultiSource
    // otomatis lempar ke source lain (Otakudesu) daripada nyodorin iframe
    // ber-iklan ke frontend.
    if (!directUrl) {
        const $ = cheerio.load(html)
        let candidateIframe: string | null = null
        $('iframe').each((_, el) => {
            if (candidateIframe) return
            const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim()
            if (src.startsWith('http')) candidateIframe = src
        })
        if (candidateIframe && getHostScore(candidateIframe) >= EXTRACTABLE_HOST_SCORE_MIN) {
            directUrl = await extractDirectVideoUrl(candidateIframe, episodeUrl)
        }
        iframe = directUrl ? candidateIframe : null
    }

    // resolved SENGAJA cuma ngecek directUrl, bukan `directUrl || iframe` —
    // ini bedanya sama resolveStreamForEpisode (Otakudesu), yang masih boleh
    // fallback ke iframe mentah karena host-nya udah dikenal/dipercaya.
    const resolved = !!directUrl
    const result: StreamResult = { iframe, directUrl, mirrors: [], resolved, availableQualities }
    if (resolved) cacheSet(cacheKey, result, 5 * 60 * 1000)
    return result
}

// ─── Source adapter contract + registry ────────────────────────────────────
// Setiap source (situs) dibungkus jadi bentuk yang sama biar orchestrator di
// bawah gak perlu tahu detail per-situs. Nambah source baru = nambah 1 entry
// di SOURCE_ADAPTERS, gak perlu ubah resolveStreamMultiSource() sama sekali.
interface SourceAdapter {
    id: string
    search(query: string): Promise<SearchResult[]>
    episodes(animeUrl: string): Promise<EpisodeEntry[]>
    resolveStream(episodeUrl: string, preferredQuality?: number | null): Promise<StreamResult>
}

const otakudesuAdapter: SourceAdapter = {
    id: 'otakudesu',
    search: async q => (await htmlSearch(q))?.results ?? [],
    episodes: resolveEpisodeList,
    resolveStream: resolveStreamForEpisode,
}

const nontonanimeidAdapter: SourceAdapter = {
    id: 'nontonanimeid',
    search: nontonSearch,
    episodes: nontonEpisodes,
    resolveStream: nontonResolveStream,
}

// ═══════════════════════════════════════════════════════════════════════════
// Sokuja adapter  (sokuja.net)
// ═══════════════════════════════════════════════════════════════════════════
//
// Sokuja adalah situs anime Indo paling stabil per 2026 — domain tunggal
// sokuja.net tidak pernah berganti, tanpa iklan judi, kualitas hingga 1080p.
//
// ⚠️  PENTING: Sokuja adalah Next.js app (bukan WordPress), dikonfirmasi dari
//     live fetch — HTML mengandung /_next/static/chunks, bukan WP assets.
//     Implikasinya:
//       • Data halaman ada di <script id="__NEXT_DATA__"> sebagai JSON blob
//         (Next.js inject semua pageProps di sini sebelum client hydration)
//       • Tidak ada JW Player / video.js config inline di HTML mentah —
//         player load via JS chunks
//       • Selector WordPress (AnimeStream/Tsun theme) tidak berlaku
//
// Struktur URL dikonfirmasi dari live fetch + Telegram channel (@sokuja):
//   - Search     : {base}/?s={query}
//   - Anime info : {base}/anime/{anime-slug}-subtitle-indonesia/
//   - Episode    : {base}/{anime-slug}-episode-{num}-subtitle-indonesia/
//
// Strategi ekstraksi video (urutan prioritas, confirmed 29 Jun 2026):
//   1. API {base}/api/video-mirrors/?e={episodeId} → direct MP4 per quality
//      (480p/720p/1080p), gak butuh Referer khusus. episodeId di-extract dari
//      "episodeId":N yang ke-embed di RSC payload halaman episode (lihat
//      extractEpisodeId()).
//   2. Fallback: parse __NEXT_DATA__-style data / regex scan HTML cari mp4/m3u8
//   3. Fallback: iframe embed kalau host dikenal bisa di-extract
//
// Mirror: x5.sokuja.uk (tercepat 247ms dari health check), sokuja.net (390ms)
// Set env SOKUJA_BASE kalau mau override domain utama.

const SOKUJA_MIRRORS: readonly string[] = [
    process.env.SOKUJA_BASE ?? 'https://x5.sokuja.uk',  // 247ms — tercepat
    'https://sokuja.net',                                 // 390ms — domain utama
    'https://x3.sokuja.uk',                              // 4.5s  — last resort
]

async function sokujFetchHtml(url: string): Promise<string> {
    return fetchSingleUrl(url)
}

// ── __NEXT_DATA__ parser ─────────────────────────────────────────────────────
// Next.js inject seluruh pageProps sebagai JSON di <script id="__NEXT_DATA__">.
// Ini satu-satunya cara dapetin data dari Sokuja tanpa nge-run JS-nya.
function parseNextData(html: string): Record<string, any> | null {
    try {
        const match = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
        if (!match) return null
        return JSON.parse(match[1])
    } catch {
        return null
    }
}

// Rekursif collect semua string values dari nested object yang kelihatan kayak
// URL video (mp4/m3u8) atau URL anime/episode. Pakai ini buat mining __NEXT_DATA__.
function collectFromObj(obj: any, target: 'video' | 'anime' | 'episode', depth = 0): string[] {
    if (depth > 8 || !obj || typeof obj !== 'object') return []
    const out: string[] = []
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
            if (target === 'video' && /\.(?:mp4|m3u8)(?:[?#]|$)/i.test(v)) {
                out.push(v.startsWith('//') ? `https:${v}` : v)
            } else if (target === 'anime' && /\/anime\/[^/]+/.test(v)) {
                out.push(v)
            } else if (target === 'episode' && /-episode-\d+/i.test(v) && !/^\/anime\//.test(v)) {
                out.push(v)
            }
        } else if (Array.isArray(v)) {
            for (const item of v) out.push(...collectFromObj(item, target, depth + 1))
        } else if (v && typeof v === 'object') {
            out.push(...collectFromObj(v, target, depth + 1))
        }
    }
    return out
}

// Sokuja search-card title kadang ke-scrape kotor: rank-badge nempel di
// depan ("10Dr. Stone...") dan type-badge ("TV"/"Movie"/dst) nempel di
// belakang ("...Part 3TV"), tanpa spasi — karena cheerio .text() ngegabung
// semua child text node (badge + judul) tanpa separator. Confirmed dari live
// search result per 29 Jun 2026. Junk ini ngerusak titleSimilarity scoring
// di resolveStreamMultiSource (token "10dr"/"3tv" gak match sama "dr"/"3"
// dari query, nge-inflate union tanpa nambah intersection) — bisa bikin
// match yang sebenernya bener malah gagal lolos CROSS_SOURCE_TITLE_THRESHOLD.
function cleanSokujCardTitle(raw: string): string {
    return raw
        .replace(/^\d{1,3}(?=[A-Za-z])/, '')                  // rank badge nempel di depan
        .replace(/(?<=\S)(TV|Movie|OVA|ONA|Special)$/i, '')   // type badge nempel di belakang
        .trim()
}

// ── Search ───────────────────────────────────────────────────────────────────
async function sokujSearch(query: string): Promise<SearchResult[]> {
    const cacheKey = `sokuja-search:${query.toLowerCase()}`
    const cached = cacheGet<SearchResult[]>(cacheKey)
    if (cached) return cached

    for (const base of SOKUJA_MIRRORS) {
        try {
            const html = await sokujFetchHtml(`${base}/?s=${encodeURIComponent(query)}`)
            const $ = cheerio.load(html)
            const seen = new Set<string>()
            const results: SearchResult[] = []

            const pushResult = (href: string, title: string, thumb: string) => {
                const norm = href.split('?')[0].replace(/\/$/, '') + '/'
                if (seen.has(norm) || !title) return
                seen.add(norm)
                results.push({ title: cleanOtakuTitle(cleanSokujCardTitle(title)), url: norm, thumb })
            }

            // Primer: Next.js __NEXT_DATA__ — paling reliable kalau ada
            const nextData = parseNextData(html)
            if (nextData) {
                const animeUrls = collectFromObj(nextData.props, 'anime')
                // Next.js biasanya simpan title di props.pageProps.posts[].title dst
                // Coba extract dari semua object yang punya title + slug/link
                const tryExtractAnime = (obj: any, d = 0): void => {
                    if (d > 6 || !obj || typeof obj !== 'object') return
                    // Kalau object punya title + (link|slug|href|url) → kemungkinan besar anime card
                    const title = obj.title || obj.name || obj.post_title
                    const link = obj.link || obj.slug || obj.href || obj.url || obj.permalink
                    if (title && link && typeof title === 'string' && typeof link === 'string') {
                        if (/\/anime\//.test(link)) {
                            const fullHref = link.startsWith('http') ? link : `${base}${link}`
                            const thumb = obj.thumbnail || obj.image || obj.cover || obj.poster || ''
                            pushResult(fullHref, title, thumb)
                        }
                    }
                    for (const v of Object.values(obj)) {
                        if (Array.isArray(v)) v.forEach(i => tryExtractAnime(i, d + 1))
                        else if (v && typeof v === 'object') tryExtractAnime(v, d + 1)
                    }
                }
                tryExtractAnime(nextData.props)
            }

            // Fallback: scan rendered HTML — Sokuja SSR-render card, jadi <a href="/anime/...">
            // biasanya sudah ada di HTML meskipun theme-nya Next.js custom
            if (results.length === 0) {
                $('a[href*="/anime/"]').each((_, el) => {
                    const a = $(el)
                    const href = (a.attr('href') ?? '').split('?')[0]
                    if (!/\/anime\/[^/]+/.test(href)) return
                    const full = href.startsWith('http') ? href : `${base}${href}`
                    const title = (
                        a.attr('title') ||
                        a.attr('aria-label') ||
                        a.find('h1,h2,h3,h4,[class*="title"],[class*="name"]').first().text() ||
                        a.text()
                    ).trim()
                    const thumb = a.find('img').attr('src') ?? a.find('img').attr('data-src') ?? ''
                    pushResult(full, title, thumb)
                })
            }

            if (results.length > 0) {
                cacheSet(cacheKey, results, 10 * 60 * 1000)
                return results
            }
        } catch { /* coba mirror berikutnya */ }
    }
    return []
}

// ── Episode list via API playlist ───────────────────────────────────────────
// API {base}/api/playlist/?slug={episode_slug} balikin SEMUA episode anime
// yang punya episode itu (currentSlug cuma echo, gak ngaruh ke isi array).
//
// ⚠️  FIX: sebelumnya slug episode pertama DITEBAK dari slug anime
//     ("...-episode-1-subtitle-indonesia"). Ternyata gak selalu valid —
//     penomoran Sokuja kadang gak mulai dari 1, atau slug episode formatnya
//     beda dikit dari pola tebakan (typo penulis, singkatan judul beda,
//     dll), jadi tebakan bisa 404 padahal anime + API-nya hidup normal.
//
//     Sekarang: scrape HALAMAN ANIME dulu buat nemu SATU link episode ASLI
//     (apapun nomornya — bisa episode 5, bisa episode 12, gak masalah),
//     baru slug ASLI itu yang dipakai buat hit API playlist. Slug tebakan
//     gak dipakai lagi sama sekali. Bonus: HTML yang sama juga dipakai
//     sebagai fallback kalau API playlist gagal/down, jadi gak ada fetch
//     dobel.
interface SokujPlaylistEpisode { slug: string; episodeNumber: string }
interface SokujPlaylistResponse { currentSlug: string; episodes: SokujPlaylistEpisode[] }

async function sokujPlaylist(episodeSlug: string): Promise<SokujPlaylistResponse | null> {
    const cacheKey = `sokuja-playlist:${episodeSlug}`
    const cached = cacheGet<SokujPlaylistResponse>(cacheKey)
    if (cached) return cached

    for (const base of SOKUJA_MIRRORS) {
        try {
            const res = await withTimeout(
                fetch(`${base}/api/playlist/?slug=${encodeURIComponent(episodeSlug)}`, {
                    headers: { ...HTML_HDRS, Accept: 'application/json' },
                    cache: 'no-store',
                }),
                5_000,
            )
            if (!res.ok) continue
            const json = await res.json() as SokujPlaylistResponse
            if (json?.episodes?.length > 0) {
                cacheSet(cacheKey, json, 10 * 60 * 1000)
                return json
            }
        } catch { /* coba mirror berikutnya */ }
    }
    return null
}

// ── Episode list ─────────────────────────────────────────────────────────────
async function sokujEpisodes(animeUrl: string): Promise<EpisodeEntry[]> {
    const cacheKey = `sokuja-eps:${extractSlug(animeUrl)}`
    const cached = cacheGet<EpisodeEntry[]>(cacheKey)
    if (cached) return cached

    const base = (() => { try { return new URL(animeUrl).origin } catch { return SOKUJA_MIRRORS[0] } })()

    // Fetch HTML halaman anime SEKALI — dipakai buat dua hal sekaligus:
    //   1. Nemu minimal SATU link episode asli (buat dapetin slug asli,
    //      bukan tebakan) yang nanti jadi kunci buat hit API playlist.
    //   2. Fallback langsung kalau API playlist gagal/down — HTML udah
    //      ke-fetch, gak perlu fetch ulang buat scrape manual.
    let html: string
    try {
        html = await sokujFetchHtml(animeUrl)
    } catch {
        return []
    }

    const animeSlugCore = (() => {
        try {
            const m = new URL(animeUrl).pathname.match(/^\/anime\/(.+?)-subtitle-indonesia\/?$/)
            return m ? m[1] : null
        } catch { return null }
    })()

    const $ = cheerio.load(html)
    const entries: EpisodeEntry[] = []
    const seen = new Set<string>()
    // Slug ASLI dari link episode pertama yang ketemu pas scrape — ini yang
    // jadi kunci buat API playlist, bukan tebakan "-episode-1-...".
    let realEpisodeSlug: string | null = null

    const pushEp = (href: string, label: string) => {
        if (!href || seen.has(href)) return
        // Exclude: URL anime page (/anime/...) dan halaman statis
        if (/^\/anime\/|^\/(tag|genre|jadwal|blog|cara-|page)\//.test(href)) return
        // Wajib ada pola episode di URL buat dikategorikan sebagai episode
        if (!/-episode-\d|-eps-\d/i.test(href) && !/-subtitle-indonesia\/?$/.test(href)) return
        // Wajib prefix-nya sama kayak anime slug ini — exclude widget
        // rekomendasi/terbaru anime LAIN yang formatnya kebetulan cocok regex
        // di atas tapi bukan episode dari anime yang lagi dicari.
        if (animeSlugCore && !href.includes(animeSlugCore)) return
        const full = href.startsWith('http') ? href : `${base}${href}`
        if (full === animeUrl.replace(/\/$/, '') || full === animeUrl) return
        seen.add(href)
        const epNum = parseEpisodeNumber(label || href, full)
        entries.push({ episode: epNum, title: label || `Episode ${epNum}`, url: full })

        // Tangkap slug asli dari episode link PERTAMA yang lolos validasi
        // di atas — apapun nomor episodenya, gak harus episode 1.
        if (!realEpisodeSlug) {
            try {
                realEpisodeSlug = new URL(full).pathname.replace(/^\/|\/$/g, '')
            } catch { /* skip kalau gagal parse, lanjut ke link berikutnya */ }
        }
    }

    // Primer (kalau ada): __NEXT_DATA__ — gak pernah ketemu di Sokuja App
    // Router per investigasi 29 Jun 2026, tapi dibiarin buat jaga-jaga kalau
    // ada varian domain/theme lain yang masih pakai Pages Router.
    const nextData = parseNextData(html)
    if (nextData) {
        const epUrls = collectFromObj(nextData.props, 'episode')
        for (const ep of epUrls) pushEp(ep, '')
        const tryEps = (obj: any, d = 0): void => {
            if (d > 6 || !obj || typeof obj !== 'object') return
            const link = obj.link || obj.slug || obj.href || obj.url
            const title = obj.title || obj.name || ''
            if (link && typeof link === 'string' && /-episode-\d/i.test(link)) {
                pushEp(link, typeof title === 'string' ? title : '')
            }
            for (const v of Object.values(obj)) {
                if (Array.isArray(v)) v.forEach(i => tryEps(i, d + 1))
                else if (v && typeof v === 'object') tryEps(v, d + 1)
            }
        }
        tryEps(nextData.props)
    }

    if (entries.length === 0) {
        $('a[href]').each((_, el) => {
            const href = ($(el).attr('href') ?? '').trim()
            pushEp(href, $(el).text().trim())
        })
    }

    // Primer: hit API playlist pakai slug ASLI hasil scrape (bukan tebakan).
    // Playlist API ngebalikin full list episode yang lebih lengkap & rapi
    // ketimbang hasil scrape <a href> doang (yang kadang kepotong
    // pagination/"load more" client-side), jadi tetap diprioritaskan walau
    // udah ada entries dari HTML scrape di atas sebagai cadangan.
    if (realEpisodeSlug) {
        const playlist = await sokujPlaylist(realEpisodeSlug)
        if (playlist && playlist.episodes.length > 0) {
            const result: EpisodeEntry[] = playlist.episodes
                .map(e => ({
                    episode: parseFloat(e.episodeNumber),
                    title: `Episode ${e.episodeNumber}`,
                    url: `${base}/${e.slug}/`,
                }))
                .filter(e => !isNaN(e.episode))
                .sort((a, b) => a.episode - b.episode)
            if (result.length > 0) {
                cacheSet(cacheKey, result, 10 * 60 * 1000)
                return result
            }
        }
    }

    // Fallback: pakai hasil scrape HTML langsung (entries) kalau API gagal,
    // down, atau gak ketemu sama sekali link episode buat dijadiin kunci.
    if (entries.length === 0) return []

    // Dedup + sort ASC by episode number
    const map = new Map<string, EpisodeEntry>()
    for (const ep of entries) {
        const key = ep.url
        if (!map.has(key)) map.set(key, ep)
    }
    const result = [...map.values()].sort((a, b) => {
        if (a.episode < 0 && b.episode < 0) return 0
        if (a.episode < 0) return 1
        if (b.episode < 0) return -1
        return a.episode - b.episode
    })

    if (result.length > 0) cacheSet(cacheKey, result, 10 * 60 * 1000)
    return result
}

// ── Stream extraction ─────────────────────────────────────────────────────────
interface SokujSource { url: string; quality: number | null }

function sokujExtractSources(html: string): SokujSource[] {
    const found: SokujSource[] = []
    const seen = new Set<string>()

    const push = (url: string, ctx: string) => {
        if (!url || seen.has(url)) return
        if (!/\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url)) return
        const full = url.startsWith('//') ? `https:${url}` : url
        if (!full.startsWith('http')) return
        seen.add(full)
        found.push({ url: full, quality: parseQualityNumber(ctx, full) })
    }

    // 1. __NEXT_DATA__ — pendekatan utama untuk Next.js app
    //    Sokuja mungkin simpan video URL di pageProps.episode.videoUrl atau serupa
    const nextData = parseNextData(html)
    if (nextData) {
        const videoUrls = collectFromObj(nextData.props, 'video')
        for (const url of videoUrls) {
            // Buat context buat nebak kualitas: coba ambil dari key di sekitarnya
            push(url, url)
        }
        // Mining lebih dalam: cari object yang punya url/file + quality/label/resolution
        const tryExtractStream = (obj: any, d = 0): void => {
            if (d > 8 || !obj || typeof obj !== 'object') return
            // Pattern: {url: "...", quality: "720p"} atau {file: "...", label: "720p"}
            const url = obj.url || obj.file || obj.src || obj.stream || obj.source || obj.videoUrl || obj.streamUrl
            const qual = obj.quality || obj.label || obj.resolution || obj.size || ''
            if (url && typeof url === 'string' && /\.(?:mp4|m3u8)/i.test(url)) {
                push(url, String(qual) + ' ' + url)
            }
            for (const v of Object.values(obj)) {
                if (Array.isArray(v)) v.forEach(i => tryExtractStream(i, d + 1))
                else if (v && typeof v === 'object') tryExtractStream(v, d + 1)
            }
        }
        tryExtractStream(nextData.props)
    }

    // 2. Regex scan seluruh HTML — tangkap URL mp4/m3u8 yang mungkin ada
    //    di dalam string JS, JSON, atau attribute yang tidak ter-parse cheerio
    const videoUrlPattern = /((?:https?:)?\/\/[^\s"'<>]+\.(?:mp4|m3u8)(?:[?#][^\s"'<>]*)?)/gi
    for (const m of html.matchAll(videoUrlPattern)) {
        const url = m[1]
        // Cari konteks kualitas di sekitar posisi match (100 char sebelumnya)
        const idx = html.indexOf(m[0])
        const ctx = html.slice(Math.max(0, idx - 100), idx + 50)
        push(url, ctx)
    }

    // 3. <video>/<source> tags (fallback kalau ada server-side rendering player)
    const $ = cheerio.load(html)
    $('video source, video').each((_, el) => {
        const src = ($(el).attr('src') ?? '').trim()
        if (src) push(src, $(el).closest('div,section').text())
    })

    return found
}

// ── episodeId extraction ──────────────────────────────────────────────────────
// Sokuja App Router nge-stream halaman via RSC payload (self.__next_f.push(...)),
// bukan <script id="__NEXT_DATA__"> klasik. episodeId numerik (dipakai buat hit
// /api/video-mirrors/?e=) ke-embed literal di payload itu sebagai "episodeId":N —
// tapi karena payload-nya sendiri adalah JSON-stringified di dalam JS string
// literal, quote-nya ke-escape jadi \"episodeId\":N di HTML mentah. Regex di
// bawah handle dua bentuk (escaped & plain) sekaligus, jadi gak perlu parse
// struktur RSC yang ruwet — confirmed dari live HTML per 29 Jun 2026.
function extractEpisodeId(html: string): number | null {
    const m = html.match(/\\?"episodeId\\?"\s*:\s*(\d+)/)
    return m ? parseInt(m[1], 10) : null
}

// ── video-mirrors API ─────────────────────────────────────────────────────────
// Endpoint internal Sokuja: GET {base}/api/video-mirrors/?e={episodeId}
// Balikin direct MP4 URL per quality (480p/720p/1080p) — confirmed live, gak
// butuh Referer/Origin khusus kayak Megaplay/Otakudesu. Jauh lebih reliable
// drpd regex-scan HTML/RSC payload, dan satu-satunya cara dapetin 1080p
// (sokujExtractSources dari HTML gak pernah nemu source di atas 720p).
interface SokujMirrorRaw {
    id: number
    serverName: string
    embedUrl: string
    embedType: string // "mp4" yang kepake; abaikan tipe lain (iframe/dll) kalau ada
    quality: string // "480p" | "720p" | "1080p"
}
interface SokujMirrorsResponse { mirrors: SokujMirrorRaw[] }

async function sokujVideoMirrors(episodeId: number): Promise<SokujSource[]> {
    const cacheKey = `sokuja-mirrors:${episodeId}`
    const cached = cacheGet<SokujSource[]>(cacheKey)
    if (cached) return cached

    for (const base of SOKUJA_MIRRORS) {
        try {
            const res = await withTimeout(
                fetch(`${base}/api/video-mirrors/?e=${episodeId}`, {
                    headers: { ...HTML_HDRS, Accept: 'application/json' },
                    cache: 'no-store',
                }),
                5_000,
            )
            if (!res.ok) continue

            const json = await res.json() as SokujMirrorsResponse
            const sources: SokujSource[] = (json.mirrors ?? [])
                .filter(m => m.embedType === 'mp4' && !!m.embedUrl)
                .map(m => ({ url: m.embedUrl, quality: parseInt(m.quality, 10) || null }))

            if (sources.length > 0) {
                cacheSet(cacheKey, sources, 10 * 60 * 1000)
                return sources
            }
        } catch { /* coba mirror berikutnya */ }
    }
    return []
}

async function sokujResolveStream(
    episodeUrl: string,
    preferredQuality?: number | null,
): Promise<StreamResult> {
    const quality = preferredQuality ?? 720
    const cacheKey = `sokuja-stream:${extractSlug(episodeUrl)}:${quality}`
    const cached = cacheGet<StreamResult>(cacheKey)
    if (cached) return cached

    let html: string
    try {
        html = await sokujFetchHtml(episodeUrl)
    } catch {
        return { iframe: null, directUrl: null, mirrors: [], resolved: false, availableQualities: [] }
    }

    // Primer: API video-mirrors — direct MP4 per quality (sampai 1080p),
    // jauh lebih reliable drpd regex/RSC-mining di bawah.
    let sources: SokujSource[] = []
    const episodeId = extractEpisodeId(html)
    if (episodeId !== null) {
        sources = await sokujVideoMirrors(episodeId)
    }

    // Fallback: __NEXT_DATA__ / regex HTML scan kalau episodeId gak ketemu
    // atau API video-mirrors gagal/kosong buat episode ini.
    if (sources.length === 0) {
        sources = sokujExtractSources(html)
    }

    const availableQualities = [...new Set(
        sources.map(s => s.quality).filter((q): q is number => q !== null)
    )].sort((a, b) => b - a)

    let directUrl: string | null = null
    let iframe: string | null = null

    if (sources.length > 0) {
        const sorted = [...sources].sort((a, b) => {
            const aMatch = a.quality === quality ? 1 : 0
            const bMatch = b.quality === quality ? 1 : 0
            if (aMatch !== bMatch) return bMatch - aMatch
            return (b.quality ?? 0) - (a.quality ?? 0)
        })
        directUrl = sorted[0].url
    }

    // Fallback: iframe — kalau API video-mirrors, __NEXT_DATA__, dan regex
    // scan ketiganya gagal, kemungkinan player Sokuja full client-side untuk
    // episode ini. Coba extract dari iframe.
    if (!directUrl) {
        const $ = cheerio.load(html)
        let candidateIframe: string | null = null
        $('iframe').each((_, el) => {
            if (candidateIframe) return
            const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim()
            if (src.startsWith('http')) candidateIframe = src
        })
        if (candidateIframe && getHostScore(candidateIframe) >= EXTRACTABLE_HOST_SCORE_MIN) {
            directUrl = await extractDirectVideoUrl(candidateIframe, episodeUrl)
        }
        iframe = directUrl ? candidateIframe : null
    }

    const resolved = !!directUrl
    const result: StreamResult = { iframe, directUrl, mirrors: [], resolved, availableQualities }
    if (resolved) cacheSet(cacheKey, result, 5 * 60 * 1000)
    return result
}

const sokujAdapter: SourceAdapter = {
    id: 'sokuja',
    search: sokujSearch,
    episodes: sokujEpisodes,
    resolveStream: sokujResolveStream,
}

// Urutan SOURCE_ADAPTERS = urutan preferensi kalau quality setara.
// Sokuja paling depan: domain stabil + 1080p support.
const SOURCE_ADAPTERS: SourceAdapter[] = [sokujAdapter, otakudesuAdapter, nontonanimeidAdapter, samehadakuAdapter]

// Lookup by id — dipakai endpoint generic adapter-search/episodes/stream
const ADAPTERS_BY_ID: Record<string, SourceAdapter> =
    Object.fromEntries(SOURCE_ADAPTERS.map(a => [a.id, a]))

// Threshold "udah cukup bagus, gak usah cari source lain" — sesuai request:
// sub indo 720p itu syarat minimum buat sebuah source "boleh nge-lock".
const STICKY_QUALITY_THRESHOLD = 720
const SOURCE_PREF_TTL_MS = 6 * 60 * 60 * 1000 // 6 jam — cukup buat sesi nonton, gak nge-lock kalau source itu lagi down kelamaan
const CROSS_SOURCE_TITLE_THRESHOLD = 0.45

async function findEpisodeUrlOnAdapter(
    adapter: SourceAdapter,
    animeTitle: string,
    episodeNum: number,
): Promise<{ url: string; score: number } | null> {
    try {
        const results = await adapter.search(animeTitle)
        if (results.length === 0) return null

        let best: { result: SearchResult; score: number } | null = null
        for (const r of results) {
            const score = titleSimilarity(animeTitle, r.title)
            if (!best || score > best.score) best = { result: r, score }
        }
        if (!best || best.score < CROSS_SOURCE_TITLE_THRESHOLD) return null

        const episodes = await adapter.episodes(best.result.url)
        const url = episodes.find(e => e.episode === episodeNum)?.url
        return url ? { url, score: best.score } : null
    } catch {
        return null
    }
}

interface MultiSourceResult {
    adapterId: string
    episodeUrl: string
    stream: StreamResult
    titleScore: number
}

// Kalau match confidence-nya di atas ini, kita percaya itu emang anime yang
// sama — quality boleh jadi penentu. Di bawah ini, anggap "cuma pas-pasan
// lolos ambang batas pencarian", jangan biarin dia menang cross-adapter cuma
// gara-gara kebetulan quality-nya lebih tinggi dari adapter lain yang match-nya
// justru lebih yakin.
const CONFIDENT_MATCH_SCORE = 0.6

// Sticky multi-source resolver. Requirement dari user: jangan lompat-lompat
// source tiap episode — kalau source yang lagi "dipegang" masih ngasih
// kualitas >= STICKY_QUALITY_THRESHOLD, langsung dipakai TANPA ngecek source
// lain sama sekali. Cuma re-evaluate (race ulang semua adapter) kalau source
// yang nge-lock gagal resolve atau kualitasnya jatuh di bawah itu (misal
// situ itu belum upload episode ini).
async function resolveStreamMultiSource(
    animeTitle: string,
    episodeNum: number,
    preferredQuality?: number | null,
    adapters: SourceAdapter[] = SOURCE_ADAPTERS,
): Promise<MultiSourceResult | null> {
    const animeKey = animeTitle.toLowerCase().trim().replace(/\s+/g, '-')
    const prefKey = `source-pref:${animeKey}`
    const stickyId = cacheGet<string>(prefKey)

    if (stickyId) {
        const adapter = adapters.find(a => a.id === stickyId)
        if (adapter) {
            const found = await findEpisodeUrlOnAdapter(adapter, animeTitle, episodeNum)
            if (found) {
                const stream = await adapter.resolveStream(found.url, preferredQuality).catch(() => null)
                if (stream?.resolved && (stream.availableQualities[0] ?? 0) >= STICKY_QUALITY_THRESHOLD) {
                    return { adapterId: stickyId, episodeUrl: found.url, stream, titleScore: found.score }
                }
                // gagal / kualitas kurang dari threshold → lanjut ke race di bawah
            }
        }
    }

    const settled = await raceAllWithCap(
        adapters.map(async adapter => {
            const found = await findEpisodeUrlOnAdapter(adapter, animeTitle, episodeNum)
            if (!found) throw new Error('not-found')
            const stream = await adapter.resolveStream(found.url, preferredQuality)
            if (!stream.resolved) throw new Error('not-resolved')
            return { adapterId: adapter.id, episodeUrl: found.url, stream, titleScore: found.score }
        }),
        20_000, // nyari + resolve di beberapa situs sekaligus, lebih lama dari race mirror tunggal
    )

    const candidates = settled.filter((r): r is MultiSourceResult => !!r)
    if (candidates.length === 0) return null

    candidates.sort((a, b) => {
        // Prioritas #1: match yang confident menang duluan, titik — gak peduli
        // quality. Ini yang nyegah kejadian kayak "Koe no Katachi" pilih 1080p
        // terus adapter lain kebetulan match ke anime LAIN yang skornya
        // pas-pasan lolos CROSS_SOURCE_TITLE_THRESHOLD tapi punya 1080p, lalu
        // menang ngalahin adapter yang match-nya bener tapi cuma 720p.
        const aConfident = a.titleScore >= CONFIDENT_MATCH_SCORE ? 1 : 0
        const bConfident = b.titleScore >= CONFIDENT_MATCH_SCORE ? 1 : 0
        if (aConfident !== bConfident) return bConfident - aConfident

        // Prioritas #2 (di dalam tier confidence yang sama): quality >= 720p
        // dianggap "cukup bagus", baru dibandingin angka quality-nya.
        const aOk = (a.stream.availableQualities[0] ?? 0) >= STICKY_QUALITY_THRESHOLD ? 1 : 0
        const bOk = (b.stream.availableQualities[0] ?? 0) >= STICKY_QUALITY_THRESHOLD ? 1 : 0
        if (aOk !== bOk) return bOk - aOk
        return (b.stream.availableQualities[0] ?? 0) - (a.stream.availableQualities[0] ?? 0)
    })

    const winner = candidates[0]
    cacheSet(prefKey, winner.adapterId, SOURCE_PREF_TTL_MS)
    return winner
}

// ─────────────────────────────────────────────────────────────────────────────
// GET handler
// ─────────────────────────────────────────────────────────────────────────────
// HLS manifests list segment URLs (often relative to the manifest's own URL)
// that the player fetches directly — if we only proxied the manifest itself,
// every segment request would still go straight to the original host and hit
// the same Referer hotlink-check this whole proxy exists to avoid. Rewriting
// each segment line to route back through this same endpoint fixes that,
// including for master playlists (their variant .m3u8 lines get rewritten
// too, recursing through this same rewrite logic on the next request).
function rewriteM3u8(manifestText: string, manifestUrl: string, refererForSegments: string): string {
    const baseUrl = new URL(manifestUrl)
    return manifestText
        .split('\n')
        .map(line => {
            const trimmed = line.trim()
            // Comments/tags pass through as-is. (EXT-X-KEY's URI= attribute for
            // encrypted HLS isn't rewritten here — fansub-hosted releases on
            // these mirrors essentially never use HLS encryption in practice.)
            if (!trimmed || trimmed.startsWith('#')) return line
            try {
                const absolute = new URL(trimmed, baseUrl).toString()
                return `/api/proxy/stream-indo?endpoint=proxy-video&url=${encodeURIComponent(absolute)}&referer=${encodeURIComponent(refererForSegments)}`
            } catch {
                return line
            }
        })
        .join('\n')
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const endpoint = searchParams.get('endpoint')

    try {
        // ── ongoing ────────────────────────────────────────────────────────────
        // Wajik API /otakudesu/ongoing mati (404). Scrape langsung dari
        // Otakudesu menggunakan infrastruktur fetchSingleUrl+cheerio yang ada.
        // Selectors dikonfirmasi dari live HTML (01 Jul 2026):
        //   .venz ul li > .detpost
        //     .epz       → "Episode N"
        //     .epztipe   → hari rilis (Senin/Selasa/…)
        //     .newnime   → tanggal update e.g. "01 Jul"
        //     .thumb a   → href = URL detail anime, img = poster
        //     h2.jdlflm  → judul anime
        // Pagination: /ongoing-anime/page/{n}/
        if (endpoint === 'ongoing') {
            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
            const pageUrl = page === 1
                ? `${MIRRORS[0]}/ongoing-anime/`
                : `${MIRRORS[0]}/ongoing-anime/page/${page}/`

            const cacheKey = `ongoing:page:${page}`
            const cached = cacheGet<object[]>(cacheKey)
            if (cached) return Response.json({ data: { animeList: cached }, pagination: { currentPage: page } })

            try {
                const html = await fetchSingleUrl(pageUrl)
                const $ = cheerio.load(html)
                const animeList: object[] = []

                $('.venz ul li').each((_, el) => {
                    const $li = $(el)
                    const $a = $li.find('.thumb a').first()
                    const href = $a.attr('href') ?? ''
                    if (!href) return

                    // Extract slug dari URL
                    const animeId = extractSlug(href)
                    if (!animeId) return

                    const title = $li.find('h2.jdlflm').text().trim()
                        || $a.attr('title')?.trim()
                        || ''
                    if (!title) return

                    // Poster: ambil srcset (resolusi lebih besar) atau src
                    const $img = $li.find('.thumb img').first()
                    const srcset = $img.attr('srcset') ?? ''
                    const srcsetFirst = srcset.split(',')[0]?.trim().split(' ')[0] ?? ''
                    const poster = srcsetFirst || $img.attr('src') || ''

                    // Episode dari ".epz": "Episode 8" → "8"
                    const epzText = $li.find('.epz').text().replace(/episode/i, '').trim()
                    const episodes = epzText || '?'

                    // Hari rilis dari ".epztipe" — icon <i> tidak punya text, tinggal trim
                    const releaseDay = $li.find('.epztipe').text().trim().toLowerCase()
                    const latestReleaseDate = $li.find('.newnime').text().trim()

                    animeList.push({ animeId, title, poster, episodes, releaseDay, latestReleaseDate })
                })

                cacheSet(cacheKey, animeList, 5 * 60 * 1000)
                return Response.json({ data: { animeList }, pagination: { currentPage: page } })
            } catch (e: any) {
                return Response.json({ error: e.message ?? 'Gagal scrape ongoing' }, { status: 500 })
            }
        }


        // ── proxy-video ────────────────────────────────────────────────────────
        // The browser's own <video src> request to a directUrl carries the
        // AnimeSya page as Referer, not the embed page that extraction used —
        // many hosts hotlink-check this and 403 it, silently degrading every
        // such episode back to the ad-having iframe even though extraction
        // itself succeeded. Routing the actual video bytes through here means
        // the browser only ever talks to our own server; we're the one
        // setting the Referer/Origin the host actually expects.
        if (endpoint === 'proxy-video') {
            const videoUrl = searchParams.get('url')
            const refererParam = searchParams.get('referer')
            if (!videoUrl) return Response.json({ error: 'url required' }, { status: 400 })

            // Only ever relay things that look like an actual video resource —
            // keeps this from becoming a general-purpose open proxy for
            // arbitrary URLs.
            if (!VIDEO_EXT_RE.test(videoUrl)) {
                return Response.json({ error: 'URL bukan video file' }, { status: 400 })
            }

            let origin: string
            try {
                origin = new URL(refererParam ?? videoUrl).origin
            } catch {
                return Response.json({ error: 'referer tidak valid' }, { status: 400 })
            }

            const rangeHeader = req.headers.get('range')

            try {
                // Cuma connect + header phase yang dibatasi timeout-nya di sini —
                // bukan seluruh body. Buat manifest, .text() di bawah juga ikut
                // kena bounded waktu connect ini sebelum mulai baca; buat video
                // bytes (return new Response(upstream.body, ...)) streaming-nya
                // tetap jalan normal gak ke-cut walau segmennya gede/lambat,
                // karena promise upstream udah resolve duluan begitu header
                // dateng. Tujuannya cuma supaya origin yang nge-hang gak bikin
                // invocation server ini nyangkut sampai dibunuh paksa sama
                // platform — gagal cepat dengan bentuk error yang sama (502
                // JSON) kayak sebelumnya, ditangkep di catch block yang sama.
                const upstream = await withTimeout(
                    fetchWithDns(videoUrl, {
                        headers: {
                            ...HTML_HDRS,
                            Referer: refererParam ?? origin,
                            Origin: origin,
                            ...(rangeHeader ? { Range: rangeHeader } : {}),
                        },
                        cache: 'no-store',
                    }),
                    10_000,
                )

                if (!upstream.ok && upstream.status !== 206) {
                    return Response.json(
                        { error: `Upstream video fetch failed: ${upstream.status}` },
                        { status: 502 }
                    )
                }

                const isManifest = /\.m3u8(?:[?#]|$)/i.test(videoUrl)
                    || (upstream.headers.get('content-type') ?? '').includes('mpegurl')

                if (isManifest) {
                    const text = await upstream.text()
                    const rewritten = rewriteM3u8(text, videoUrl, refererParam ?? origin)
                    return new Response(rewritten, {
                        status: upstream.status,
                        headers: {
                            'content-type': 'application/vnd.apple.mpegurl',
                            'cache-control': 'no-store',
                        },
                    })
                }

                const headers = new Headers()
                const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']
                for (const h of passthrough) {
                    const v = upstream.headers.get(h)
                    if (v) headers.set(h, v)
                }
                if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes')

                return new Response(upstream.body, { status: upstream.status, headers })
            } catch {
                return Response.json({ error: 'Gagal proxy video' }, { status: 502 })
            }
        }

        // ── search ─────────────────────────────────────────────────────────────
        if (endpoint === 'search') {
            const q = searchParams.get('q')
            if (!q) return Response.json({ error: 'q required' }, { status: 400 })

            const altTitles = searchParams.get('altTitles')
            const altList = altTitles
                ? altTitles.split(',').map((t: string) => t.trim()).filter(Boolean)
                : []

            const hits = await searchBest(q, altList)
            if (hits.length === 0) return Response.json({ data: [], matchedQuery: null })

            return Response.json({
                data: hits.map(h => h.result),
                matchedQuery: hits[0].matchedQuery,
            })
        }

        // ── episodes ───────────────────────────────────────────────────────────
        if (endpoint === 'episodes') {
            const url = searchParams.get('url')
            const maxEpisode = parsePositiveEpisodeParam(searchParams.get('maxEpisode'))
            if (!url) return Response.json({ error: 'url required' }, { status: 400 })

            const episodes = filterByMaxEpisode(await resolveEpisodeList(url), maxEpisode)
            return Response.json({ data: episodes, maxEpisode })
        }

        // ── anime-info ─────────────────────────────────────────────────────────
        // ?endpoint=anime-info&url=<url-anime>
        // Metadata detail anime (title/poster/sinopsis/genre/status/studio/dll).
        // ⚠️ Selector parser-nya BEST-GUESS (lihat catatan di parseAnimeInfo) —
        // belum pernah diverifikasi live buat halaman detail. Kalau ada field
        // yang balik null/kosong, cross-check dulu via
        // ?endpoint=debug-anime-info sebelum dipasang ke halaman production.
        if (endpoint === 'anime-info') {
            const url = searchParams.get('url')
            if (!url) return Response.json({ error: 'url required' }, { status: 400 })

            const info = await resolveAnimeInfo(url)
            if (!info) {
                return Response.json(
                    { error: 'Gagal parse info anime — cek ?endpoint=debug-anime-info buat lihat HTML mentahnya & sesuaikan selector' },
                    { status: 500 }
                )
            }
            return Response.json({ data: info })
        }

        // ── download ───────────────────────────────────────────────────────────
        // ?endpoint=download&url=<url-episode>
        // Opsional: &quality=720p&host=mega → langsung balikin 1 link spesifik
        // (plus &resolve=1 untuk mencoba follow shortlink ke target asli — lihat
        // catatan di resolveDesuStreamLink, belum terverifikasi penuh).
        if (endpoint === 'download') {
            const url = searchParams.get('url')
            const quality = searchParams.get('quality')
            const host = searchParams.get('host')
            const shouldResolve = searchParams.get('resolve') === '1'
            if (!url) return Response.json({ error: 'url required' }, { status: 400 })

            const cacheKey = `download:${url}`
            let groups = cacheGet<DownloadQualityGroup[]>(cacheKey)
            if (!groups) {
                try {
                    const { html } = await scrapeHtml(url)
                    groups = parseDownloadLinks(html)
                    if (groups.length > 0) cacheSet(cacheKey, groups, 15 * 60 * 1000)
                } catch {
                    return Response.json(
                        { error: 'Gagal mengambil halaman episode — coba lagi beberapa menit' },
                        { status: 500 }
                    )
                }
            }

            if (quality && host) {
                const link = findDownloadHost(groups, quality, host)
                if (!link)
                    return Response.json(
                        { error: `Link ${host} ${quality} tidak ditemukan di episode ini` },
                        { status: 404 }
                    )
                const resolved = shouldResolve ? await resolveDesuStreamLink(link, url) : null
                return Response.json({ data: { quality, host, url: link, resolvedUrl: resolved } })
            }

            return Response.json({ data: groups })
        }

        // ── stream ─────────────────────────────────────────────────────────────
        if (endpoint === 'stream') {
            const url = searchParams.get('url')
            if (!url) return Response.json({ error: 'url required' }, { status: 400 })

            const qualityParam = searchParams.get('quality')
            const preferredQuality = qualityParam && qualityParam !== 'auto' ? parseInt(qualityParam, 10) : null

            const result = await resolveStreamForEpisode(url, preferredQuality)
            return Response.json({ data: result })
        }

        // ── debug-html ─────────────────────────────────────────────────────────
        // DEV ONLY — dump raw scraped HTML + parsed episode list for a given URL
        // Usage: /api/proxy/stream-indo?action=debug-html&url=https://otakudesu.cloud/anime/...
        if (endpoint === 'debug-html') {
            const url = searchParams.get('url')
            if (!url) return Response.json({ error: 'url required' }, { status: 400 })
            try {
                const { html, base } = await scrapeHtml(url)
                const episodes = parseEpisodes(html, base)
                const $ = cheerio.load(html)
                const liDebug: object[] = []
                $('.episodelist li, .eplister ul li, .eplister li').each((i, el) => {
                    liDebug.push({
                        index: i,
                        classes: $(el).attr('class') ?? '',
                        href: $(el).find('a').attr('href') ?? '',
                        text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120),
                        eplDate: $(el).find('.epl-date, .epl-sub-date, [class*="date"]').first().text().trim(),
                        eplNum: $(el).find('.epl-num').text().trim(),
                    })
                })
                return Response.json({ base, episodesParsed: episodes, liDebug, htmlSnippet: html.slice(0, 4000) })
            } catch (e) {
                return Response.json({ error: String(e) }, { status: 500 })
            }
        }

        // ── debug-anime-info ──────────────────────────────────────────────────
        // DEV ONLY — cross-check selector best-guess parseAnimeInfo() sebelum
        // dipasang ke ?endpoint=anime-info production. Dump hasil parse tiap
        // field SATU-SATU (bukan cuma final object-nya) plus konteks HTML
        // mentah di sekitar ".infozingle", ".sinopc", ".fotoanime" — biar
        // kalau ada selector yang meleset, gampang liat struktur real-nya
        // dan langsung tau harus diganti ke apa.
        //
        // Usage:
        //   ?endpoint=debug-anime-info&url={anime_url}
        //   ?endpoint=debug-anime-info&slug={anime-slug}   → dibangun ke
        //     `${MIRRORS[0]}/anime/{slug}/` otomatis
        if (endpoint === 'debug-anime-info') {
            const rawUrl = searchParams.get('url')
            const slug = searchParams.get('slug')
            const url = rawUrl ?? (slug ? `${MIRRORS[0]}/anime/${slug}/` : null)
            if (!url) return Response.json({ error: 'url atau slug required' }, { status: 400 })

            try {
                const { html, base } = await scrapeHtml(url)
                const $ = cheerio.load(html)
                const info = parseAnimeInfo(html, base)

                // Dump tiap baris .infozingle p mentah-mentah, biar keliatan
                // label apa aja yang sebenarnya dipakai kalau beda dari
                // dugaan (mis. "Total Episode" vs "Total Eps").
                const infozingleRows: { label: string; rawText: string }[] = []
                $('.infozingle p').each((_, el) => {
                    infozingleRows.push({
                        label: $(el).find('span').first().text().trim(),
                        rawText: $(el).text().replace(/\s+/g, ' ').trim(),
                    })
                })

                const findContext = (needle: string) => {
                    const idx = html.indexOf(needle)
                    return idx >= 0 ? html.slice(Math.max(0, idx - 80), idx + 300) : null
                }

                return Response.json({
                    url,
                    base,
                    htmlLength: html.length,
                    parsed: info,
                    infozingleRowsFound: infozingleRows.length,
                    infozingleRows,
                    selectorHits: {
                        '.infozingle': $('.infozingle').length,
                        '.jdlrx h1': $('.jdlrx h1').length,
                        '.fotoanime img': $('.fotoanime img').length,
                        '.sinopc': $('.sinopc').length,
                        '.venser .sinopc': $('.venser .sinopc').length,
                        'meta[property="og:image"]': $('meta[property="og:image"]').length,
                    },
                    rawContext: {
                        infozingle: findContext('infozingle'),
                        sinopc: findContext('sinopc'),
                        fotoanime: findContext('fotoanime'),
                    },
                })
            } catch (e: any) {
                return Response.json({ url, error: e.message }, { status: 500 })
            }
        }

        // ── auto ───────────────────────────────────────────────────────────────
        if (endpoint === 'auto') {
            const malId = searchParams.get('malId')
            const titleParam = searchParams.get('title')
            const episodeNum = Math.max(1, parseInt(searchParams.get('episode') ?? '1', 10))
            const maxEpisode = parsePositiveEpisodeParam(searchParams.get('maxEpisode'))
            // 'auto' (default, current host-priority behaviour) or an explicit
            // 360/480/720/1080 resolution the user picked from the quality selector.
            const qualityParam = searchParams.get('quality')
            const preferredQuality = qualityParam && qualityParam !== 'auto' ? parseInt(qualityParam, 10) : null

            if (!malId && !titleParam)
                return Response.json({ error: 'malId atau title required' }, { status: 400 })

            const altTitlesParam = searchParams.get('altTitles')
            const altTitlesList = altTitlesParam
                ? altTitlesParam.split(',').map((t: string) => t.trim()).filter(Boolean)
                : []

            const cacheKey = `auto:${malId ?? titleParam}:${altTitlesList.join('|')}:${episodeNum}:max${maxEpisode ?? 'none'}:q${preferredQuality ?? 'auto'}`
            const cached = cacheGet<object>(cacheKey)
            if (cached) return Response.json({ data: cached })

            let primary = titleParam ?? ''
            let alts: string[] = [...altTitlesList]

            if (malId) {
                if (titleParam) {
                    // Client sudah punya title (dari Jikan fetch di page.tsx) — pakai itu
                    // sebagai primary, dan coba ambil Jikan alts tambahan secara best-effort
                    // (tidak fatal kalau gagal/rate-limited, karena primary sudah ada).
                    primary = titleParam
                    try {
                        const jikanInfo = await fetchJikanTitlesByMalId(malId)
                        if (jikanInfo) alts = [...alts, ...jikanInfo.alts]
                    } catch { }
                } else {
                    // Tidak ada title dari client — wajib resolve via Jikan.
                    const jikanInfo = await fetchJikanTitlesByMalId(malId)
                    if (jikanInfo) {
                        primary = jikanInfo.primary
                        alts = [...alts, ...jikanInfo.alts]
                    } else {
                        return Response.json(
                            { error: `Gagal resolve judul dari MAL ID: ${malId}` },
                            { status: 404 }
                        )
                    }
                }
            }

            // Dedupe alts
            alts = [...new Set(alts.filter(Boolean))]

            const hits = await searchBest(primary, alts)
            if (hits.length === 0)
                return Response.json(
                    { error: `Anime tidak ditemukan — judul: "${primary}"`, triedTitle: primary },
                    { status: 404 }
                )

            let episodes: EpisodeEntry[] = []
            let matchedHit: typeof hits[0] | null = null

            // First pass: only confident matches (score >= 0.15), tried in
            // parallel (capped) instead of one at a time.
            const confidentHits = hits.filter(h => h.score >= 0.15)
            const firstPass = await resolveFirstWithEpisodes(confidentHits, maxEpisode, episodeNum)
            if (firstPass) {
                episodes = firstPass.episodes
                matchedHit = firstPass.matchedHit
            }

            // Second pass: if nothing matched (e.g. MAL title differs significantly
            // from the Otakudesu listing title), fall back to trying the
            // remaining hits regardless of score, ordered by score desc —
            // also tried in parallel (capped).
            if (episodes.length === 0) {
                const tried = new Set(confidentHits.map(h => h.result.url))
                const remaining = hits
                    .filter(h => !tried.has(h.result.url))
                    .sort((a, b) => b.score - a.score)

                const secondPass = await resolveFirstWithEpisodes(remaining, maxEpisode, episodeNum)
                if (secondPass) {
                    episodes = secondPass.episodes
                    matchedHit = secondPass.matchedHit
                }
            }

            if (episodes.length === 0 || !matchedHit)
                return Response.json(
                    { error: 'Daftar episode kosong atau gagal diambil' },
                    { status: 404 }
                )

            // Exact match first, then nearest episode fallback
            const exactMatch = episodes.find(ep => ep.episode === episodeNum)
            const targetEp = exactMatch ?? episodes.reduce((nearest, ep) =>
                Math.abs(ep.episode - episodeNum) < Math.abs(nearest.episode - episodeNum)
                    ? ep
                    : nearest
            )

            // Otakudesu backfills old episodes of ultra-long shows "secara
            // berkala" (periodically) — One Piece/Detective Conan-class
            // catalogs can have a literal placeholder post marking a
            // multi-hundred-episode gap that simply isn't uploaded yet. If
            // the closest thing we found is more than this many episodes
            // away from what was asked for, that's not "episode not aired
            // yet" territory anymore — it's "doesn't exist here at all", and
            // silently handing back some unrelated arc would be worse than
            // just saying so.
            const NEAREST_EPISODE_GAP_LIMIT = 20
            if (!exactMatch && Math.abs(targetEp.episode - episodeNum) > NEAREST_EPISODE_GAP_LIMIT) {
                return Response.json(
                    {
                        error: `Episode ${episodeNum} belum ada di Otakudesu (kemungkinan masih dalam proses backfill) — episode terdekat yang tersedia cuma Ep ${targetEp.episode}. Coba server SUB/DUB.`,
                        episodeRequested: episodeNum,
                        nearestAvailable: targetEp.episode,
                    },
                    { status: 404 }
                )
            }

            if (!targetEp.url)
                return Response.json(
                    { error: `URL episode ${episodeNum} tidak valid` },
                    { status: 404 }
                )

            // ── Stream resolution: Consumet (ad-free) raced against Otakudesu scrape ──
            // Consumet gives a direct .m3u8 URL — no embed pages, no ad-injected iframes.
            // IMPORTANT: these two now run CONCURRENTLY, not sequentially. The public
            // Consumet instance (onrender.com free tier) can cold-start for 20-50s when
            // idle; previously that was fully awaited BEFORE even starting the Otakudesu
            // scrape, making total latency consumet_time + otakudesu_time. Running them
            // in parallel makes it max(consumet_time, otakudesu_time) instead — Consumet
            // still wins and is preferred when it succeeds, it just no longer blocks the
            // fallback path from starting.
            let stream: StreamResult
            let streamSource: 'consumet' | 'otakudesu' = 'otakudesu'

            const [consumetOutcome, otakudesuOutcome] = await Promise.allSettled([
                malId ? consumetFetchStreamUrl(malId, episodeNum, primary || titleParam || '').catch(() => null) : Promise.resolve(null),
                resolveStreamForEpisode(targetEp.url, preferredQuality),
            ])

            const consumetUrl = consumetOutcome.status === 'fulfilled' ? consumetOutcome.value : null

            if (consumetUrl) {
                // Consumet only ever gives one URL, not a per-quality menu — so
                // it can't honor preferredQuality. If the user explicitly asked
                // for a specific resolution, skip Consumet and use the Otakudesu
                // path instead, since that's the one that actually has quality
                // tiers to pick from.
                if (preferredQuality && otakudesuOutcome.status === 'fulfilled' && otakudesuOutcome.value.resolved) {
                    stream = otakudesuOutcome.value
                } else {
                    stream = { iframe: null, directUrl: consumetUrl, mirrors: [], resolved: true, availableQualities: [] }
                    streamSource = 'consumet'
                }
            } else if (otakudesuOutcome.status === 'fulfilled') {
                stream = otakudesuOutcome.value
            } else {
                stream = { iframe: null, directUrl: null, mirrors: [], resolved: false, availableQualities: [] }
            }

            const result = {
                anime: matchedHit.result,
                episodes,
                currentEpisode: { ...targetEp, ...stream },
                meta: {
                    episodeRequested: episodeNum,
                    episodeFound: targetEp.episode,
                    isExactMatch: !!exactMatch,
                    // Explicit human-readable warning when we fell back to a
                    // different episode — lets the frontend show a toast/banner
                    // without having to reconstruct the message itself.
                    fallbackWarning: !exactMatch
                        ? `⚠️ Episode ${episodeNum} tidak ada di Otakudesu — menampilkan episode terdekat: Ep ${targetEp.episode}`
                        : null,
                    matchedQuery: matchedHit.matchedQuery,
                    resolvedByMalId: !!malId,
                    maxEpisode,
                    streamSource, // 'consumet' | 'otakudesu' — useful for debug & frontend badge
                },
            }

            if (stream.resolved) cacheSet(cacheKey, result, 5 * 60 * 1000)
            return Response.json({ data: result })
        }

        // ── multi-stream ───────────────────────────────────────────────────────
        // Sticky multi-source resolver — endpoint baru, terpisah dari /auto dan
        // /stream supaya gak ganggu jalur Otakudesu yang udah jalan. Nambah
        // adapter baru (Sokuja/Oploverz dst) tinggal masuk ke SOURCE_ADAPTERS,
        // endpoint ini gak perlu diubah.
        if (endpoint === 'multi-stream') {
            const title = searchParams.get('title')
            const episodeParam = searchParams.get('episode')
            const preferredQuality = parsePositiveEpisodeParam(searchParams.get('quality'))

            if (!title || !episodeParam)
                return Response.json({ error: 'title & episode required' }, { status: 400 })

            const episodeNum = parseFloat(episodeParam)
            if (isNaN(episodeNum))
                return Response.json({ error: 'episode harus angka' }, { status: 400 })

            const result = await resolveStreamMultiSource(title, episodeNum, preferredQuality)
            if (!result)
                return Response.json(
                    { error: `Episode ${episodeNum} dari "${title}" gak ketemu di semua source yang aktif` },
                    { status: 404 }
                )

            return Response.json({
                data: {
                    source: result.adapterId, // 'otakudesu' | 'nontonanimeid' — buat badge di frontend
                    episodeUrl: result.episodeUrl,
                    ...result.stream,
                },
            })
        }

        // ── resolve ────────────────────────────────────────────────────────────
        if (endpoint === 'resolve') {
            const post = searchParams.get('post')
            const nume = searchParams.get('nume')
            const type = searchParams.get('type') ?? 'tv'
            const nonce = searchParams.get('nonce') ?? ''
            const referer = searchParams.get('referer') ?? MIRRORS[0]

            if (!post || !nume)
                return Response.json({ error: 'post & nume required' }, { status: 400 })

            const cacheKey = `resolve:${post}:${nume}`
            const cached = cacheGet<string>(cacheKey)
            if (cached) return Response.json({ data: { iframe: cached } })

            // Bug fix: resolveMirrorUrl expects MirrorMeta ({ content: {...} }),
            // not the raw fields directly. Wrap them so resolveSingleMirrorBase
            // spreads the correct keys into the AJAX body payload.
            const iframe = await resolveMirrorUrl({ content: { post, nume, type, nonce } }, referer)
            if (!iframe)
                return Response.json(
                    { error: 'Gagal resolve mirror URL — coba server lain' },
                    { status: 404 }
                )

            cacheSet(cacheKey, iframe, 5 * 60 * 1000)
            return Response.json({ data: { iframe } })
        }

        // ── debug ──────────────────────────────────────────────────────────────
        if (endpoint === 'debug') {
            const url = searchParams.get('url')

            if (!url) {
                const checks = await Promise.allSettled(
                    MIRRORS.map(async base => {
                        const t0 = Date.now()
                        try {
                            const res = await withTimeout(
                                fetch(`${base}/`, { headers: HTML_HDRS, cache: 'no-store' }),
                                5_000
                            )
                            return { mirror: base, alive: res.ok, ms: Date.now() - t0, status: res.status }
                        } catch (e: any) {
                            return { mirror: base, alive: false, ms: Date.now() - t0, error: e.message }
                        }
                    })
                )
                return Response.json({
                    mirrors: checks.map(r => r.status === 'fulfilled' ? r.value : { error: 'failed' }),
                    consumet: {
                        enabled: CONSUMET_ENABLED,
                        base: CONSUMET_BASE,
                    },
                })
            }

            try {
                const { html, base } = await scrapeHtml(url)
                const mirrors = parseMirrors(html)
                return Response.json({
                    url,
                    base,
                    htmlLength: html.length,
                    mirrorCount: mirrors.length,
                    mirrors,
                    hasEpisodeList: html.includes('episodelist') || html.includes('eplister'),
                    snippet: html.slice(0, 500),
                })
            } catch (e: any) {
                return Response.json({ url, error: e.message }, { status: 500 })
            }
        }

        // ── debug-sokuja ──────────────────────────────────────────────────────
        // Inspeksi HTML mentah + sources Sokuja. Pakai ini kalau sokujExtractSources
        // gagal buat episode tertentu — dump hasilnya ke console buat debug.
        //
        // Usage:
        //   ?endpoint=debug-sokuja                         → health check semua mirror
        //   ?endpoint=debug-sokuja&url={episode_url}       → dump sources + iframes
        //   ?endpoint=debug-sokuja&url={anime_url}         → dump episode links
        if (endpoint === 'debug-sokuja') {
            const url = searchParams.get('url')

            if (!url) {
                const checks = await Promise.allSettled(
                    SOKUJA_MIRRORS.map(async base => {
                        const t0 = Date.now()
                        try {
                            const html = await withTimeout(sokujFetchHtml(`${base}/`), 8_000)
                            return { mirror: base, alive: html.length > 200, ms: Date.now() - t0, htmlLength: html.length }
                        } catch (e: any) {
                            return { mirror: base, alive: false, ms: Date.now() - t0, error: e.message }
                        }
                    })
                )
                return Response.json({
                    sokujaMirrors: checks.map(r => r.status === 'fulfilled' ? r.value : { error: 'failed' }),
                })
            }

            try {
                const html = await sokujFetchHtml(url)
                const sources = sokujExtractSources(html)
                const $ = cheerio.load(html)

                // ── v9: cek hasil ekstraksi episodeId + API video-mirrors ──
                // langsung di sini, biar gampang ditest dari browser tanpa
                // perlu lewat full watch page.
                const episodeId = extractEpisodeId(html)
                const videoMirrorsApi = episodeId !== null ? await sokujVideoMirrors(episodeId) : []

                // Kumpulkan semua iframe candidates
                const iframes: string[] = []
                $('iframe').each((_, el) => {
                    const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim()
                    if (src) iframes.push(src)
                })

                // Kumpulkan episode links (buat debug halaman anime)
                const episodeLinks: string[] = []
                $('a').each((_, el) => {
                    const href = $(el).attr('href') ?? ''
                    if (/-episode-\d|-eps-\d/i.test(href) && !/^\/anime\//.test(href)) episodeLinks.push(href)
                })

                // Dump __NEXT_DATA__ — ini kunci untuk debug Next.js app Sokuja
                const nextData = parseNextData(html)
                const nextDataPageProps = nextData?.props?.pageProps
                    ? Object.keys(nextData.props.pageProps)
                    : []
                const nextDataVideos = nextData ? collectFromObj(nextData.props, 'video') : []
                const nextDataEpisodes = nextData ? collectFromObj(nextData.props, 'episode') : []

                return Response.json({
                    url,
                    htmlLength: html.length,
                    isNextJs: html.includes('__NEXT_DATA__'),
                    episodeId,
                    videoMirrorsApi,
                    nextDataPageProps,
                    nextDataVideos: nextDataVideos.slice(0, 10),
                    nextDataEpisodes: nextDataEpisodes.slice(0, 20),
                    sourcesFound: sources,
                    availableQualities: [...new Set(sources.map(s => s.quality).filter(Boolean))].sort((a, b) => (b ?? 0) - (a ?? 0)),
                    iframes,
                    episodeLinks: episodeLinks.slice(0, 20),
                    hasPlayerScript: html.includes('jwplayer') || html.includes('videojs') || html.includes('plyr'),
                    nextDataSnippet: nextData ? JSON.stringify(nextData.props?.pageProps ?? {}).slice(0, 3000) : null,
                    // Dump potongan HTML mentah di sekitar kata kunci video/player/stream
                    // supaya bisa debug hybrid site yang gak pakai __NEXT_DATA__
                    htmlVideoContext: (() => {
                        const keywords = ['m3u8', '.mp4', 'stream', 'videoUrl', 'fileUrl', 'window.__', 'data-src', 'data-video', 'dplayer', 'artplayer', 'hlsUrl', 'hls_url']
                        const hits: { kw: string; ctx: string }[] = []
                        for (const kw of keywords) {
                            const idx = html.indexOf(kw)
                            if (idx >= 0) hits.push({ kw, ctx: html.slice(Math.max(0, idx - 60), idx + 120) })
                        }
                        return hits
                    })(),
                    // Cari semua window.__ assignments (common pattern buat client-side data injection)
                    windowAssignments: (() => {
                        const matches = [...html.matchAll(/window\.(__[A-Z_]+|[A-Z_]{2,})\s*=/g)]
                        return matches.map(m => m[0]).slice(0, 20)
                    })(),
                })

            } catch (e: any) {
                return Response.json({ url, error: e.message }, { status: 500 })
            }
        }

        // ── debug-sokuja-search ──────────────────────────────────────────────
        // Tes ulang pipeline yang dipake findEpisodeUrlOnAdapter() di
        // resolveStreamMultiSource — search → title-match → episode lookup.
        // Dibikin karena debug-sokuja (di atas) cuma tes ekstraksi pas URL
        // episode-nya udah dikasih langsung; ini buat ngecek tahap SEBELUM
        // itu, yang ternyata bisa gagal duluan walau video-mirrors API-nya
        // sendiri udah confirmed jalan.
        //
        // Usage: ?endpoint=debug-sokuja-search&q={anime_title}&episode={num}
        if (endpoint === 'debug-sokuja-search') {
            const q = searchParams.get('q')
            const episodeParam = searchParams.get('episode')
            if (!q) return Response.json({ error: 'q required' }, { status: 400 })

            try {
                const searchResults = await sokujSearch(q)
                const scored = searchResults
                    .map(r => ({ ...r, score: titleSimilarity(q, r.title) }))
                    .sort((a, b) => b.score - a.score)
                const best = scored[0] ?? null
                const bestPassesThreshold = !!best && best.score >= CROSS_SOURCE_TITLE_THRESHOLD

                let episodes: EpisodeEntry[] = []
                let matchedEpisode: EpisodeEntry | null = null
                if (bestPassesThreshold && best) {
                    episodes = await sokujEpisodes(best.url)
                    if (episodeParam) {
                        const epNum = parseFloat(episodeParam)
                        matchedEpisode = episodes.find(e => e.episode === epNum) ?? null
                    }
                }

                return Response.json({
                    query: q,
                    searchResultsCount: searchResults.length,
                    searchResultsTop5: scored.slice(0, 5),
                    crossSourceTitleThreshold: CROSS_SOURCE_TITLE_THRESHOLD,
                    bestMatch: best,
                    bestPassesThreshold,
                    episodesFoundCount: episodes.length,
                    episodesSample: episodes.slice(0, 5),
                    matchedEpisode,
                })
            } catch (e: any) {
                return Response.json({ query: q, error: e.message }, { status: 500 })
            }
        }

        // ── adapter-search ── ?endpoint=adapter-search&source=samehadaku&q=judul
        if (endpoint === 'adapter-search') {
            const source = searchParams.get('source')
            const q = searchParams.get('q')
            if (!source || !q) return Response.json({ error: 'source & q required' }, { status: 400 })
            const adapter = ADAPTERS_BY_ID[source]
            if (!adapter) return Response.json({ error: `unknown source: ${source}` }, { status: 400 })

            try {
                const data = await adapter.search(q)
                return Response.json({ data })
            } catch (e) {
                return Response.json({ error: `adapter-search gagal: ${(e as Error).message}` }, { status: 500 })
            }
        }

        // ── adapter-episodes ── ?endpoint=adapter-episodes&source=samehadaku&url=<url-anime>
        if (endpoint === 'adapter-episodes') {
            const source = searchParams.get('source')
            const url = searchParams.get('url')
            if (!source || !url) return Response.json({ error: 'source & url required' }, { status: 400 })
            const adapter = ADAPTERS_BY_ID[source]
            if (!adapter) return Response.json({ error: `unknown source: ${source}` }, { status: 400 })

            try {
                const data = await adapter.episodes(url)
                return Response.json({ data })
            } catch (e) {
                return Response.json({ error: `adapter-episodes gagal: ${(e as Error).message}` }, { status: 500 })
            }
        }

        // ── adapter-stream ── ?endpoint=adapter-stream&source=samehadaku&url=<url-episode>&quality=720
        if (endpoint === 'adapter-stream') {
            const source = searchParams.get('source')
            const url = searchParams.get('url')
            const quality = searchParams.get('quality')
            if (!source || !url) return Response.json({ error: 'source & url required' }, { status: 400 })
            const adapter = ADAPTERS_BY_ID[source]
            if (!adapter) return Response.json({ error: `unknown source: ${source}` }, { status: 400 })

            try {
                const data = await adapter.resolveStream(url, quality ? parseInt(quality, 10) : null)
                return Response.json({ data })
            } catch (e) {
                return Response.json({ error: `adapter-stream gagal: ${(e as Error).message}` }, { status: 500 })
            }
        }

        return Response.json({ error: 'endpoint tidak valid' }, { status: 400 })

    } catch (e: any) {
        const msg = e.message?.includes('SCRAPE_FAILED')
            ? 'Semua mirror tidak bisa diakses — coba beberapa menit lagi'
            : e.message ?? 'Internal error'
        return Response.json({ error: msg }, { status: 500 })
    }
}