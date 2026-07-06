// lib/adapters/samehadaku.ts
//
// Adapter Samehadaku — source ke-4, nambah coverage anime yang gak ke-cover
// Otakudesu/Sokuja/NontonAnimeID.
//
// ⚠️ CATATAN PENTING (baca sebelum dipakai production):
// Selector di bawah ini BEST-GUESS berdasarkan struktur umum tema WordPress
// anime streaming yang biasa dipakai situs sejenis (grid `.animpost`, mirror
// player via AJAX ke admin-ajax.php dengan action `player_ajax`). Situs
// Samehadaku sering ganti domain & kadang ganti tema, jadi:
//   1. Sebelum production, tes dulu tiap fungsi ini satu-satu.
//   2. Kalau ada yang return kosong, cek HTML aktualnya (curl / view-source)
//      dan sesuaikan selector-nya — sama kayak proses "3 bug fix berurutan"
//      pas integrasi Sokuja dulu.
//   3. Domain Samehadaku sering pindah karena diblokir — taro base URL di
//      env var (SAMEHADAKU_BASE), jangan hardcode, biar gampang diganti
//      tanpa redeploy ulang kodenya.

import * as cheerio from 'cheerio'
import { Agent, fetch as undiciFetch } from 'undici'

interface SearchResult { title: string; url: string; thumb: string }
interface EpisodeEntry { episode: number; title: string; url: string }
interface MirrorOption { label: string; quality: string; content: Record<string, unknown> }
interface StreamResult {
    iframe: string | null
    directUrl: string | null
    mirrors: MirrorOption[]
    resolved: boolean
    availableQualities: number[]
}
interface SourceAdapter {
    id: string
    search(query: string): Promise<SearchResult[]>
    episodes(animeUrl: string): Promise<EpisodeEntry[]>
    resolveStream(episodeUrl: string, preferredQuality?: number | null): Promise<StreamResult>
}

const SAMEHADAKU_BASE = process.env.SAMEHADAKU_BASE ?? 'https://samehadaku.li'

// ─────────────────────────────────────────────────────────────────────────────
// DoH — PARALLEL Cloudflare + Google (Bypass Internet Positif / ISP Hijacking)
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
        const ip = await Promise.race([
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
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ])
        _dohCache.set(hostname, { ip, expiresAt: Date.now() + 60 * 60 * 1000 })
        return ip
    } catch {
        return null
    }
}

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

async function fetchHtml(url: string): Promise<string> {
    const res = await fetchWithDns(url, {
        headers: {
            // Beberapa tema WP block request tanpa UA browser yang wajar
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        },
    })
    if (!res.ok) throw new Error(`Samehadaku fetch gagal: ${res.status} ${url}`)
    return res.text()
}

/** "https://samehadaku.li/anime/judul-anime/" → "judul-anime" */
function extractSlug(url: string): string | null {
    const m = url.match(/\/anime\/([^/]+)\/?/) ?? url.match(/\/([^/]+)\/?$/)
    return m ? m[1] : null
}

export const samehadakuAdapter: SourceAdapter = {
    id: 'samehadaku',

    async search(query: string): Promise<SearchResult[]> {
        const url = `${SAMEHADAKU_BASE}/?s=${encodeURIComponent(query)}`
        const html = await fetchHtml(url)
        const $ = cheerio.load(html)
        const results: SearchResult[] = []

        // ⚠️ BEST-GUESS: grid hasil search tema anime WP umumnya pake class
        // `.animpost` atau `.bsx` per-card. Kalau kosong, cek selector aslinya.
        const cards = $('.animpost').length ? $('.animpost') : $('.bsx')
        cards.each((_, el) => {
            const $el = $(el)
            const $a = $el.find('a').first()
            const href = $a.attr('href') ?? ''
            if (!href) return

            const title =
                $el.find('.tt h2').text().trim() ||
                $el.find('.title').text().trim() ||
                $el.find('.tt').text().trim() ||
                $a.attr('title')?.trim() ||
                ''
            if (!title) return

            const thumb = $el.find('img').first().attr('src') ?? ''

            results.push({ title, url: href, thumb })
        })

        return results
    },

    async episodes(animeUrl: string): Promise<EpisodeEntry[]> {
        const html = await fetchHtml(animeUrl)
        const $ = cheerio.load(html)
        const entries: EpisodeEntry[] = []

        // ⚠️ BEST-GUESS: daftar episode biasanya di `.eplister ul li`, `.lstepsiode ul li` atau
        // `.episodelist li`. Coba semuanya, ambil yang ketemu.
        const $items = $('.eplister ul li').length
            ? $('.eplister ul li')
            : $('.lstepsiode ul li').length
            ? $('.lstepsiode ul li')
            : $('.episodelist li')

        $items.each((_, el) => {
            const $el = $(el)
            const $a = $el.find('a').first()
            const href = $a.attr('href') ?? ''
            if (!href) return

            // "Episode 12" → 12 (ambil angka pertama yang muncul)
            const text = $el.find('.epsright, .lchx, a').first().text().replace(/\s+/g, ' ').trim()
            const match = text.match(/(\d+)/)
            if (!match) return
            const episode = parseInt(match[1], 10)

            entries.push({ episode, title: text || `Episode ${episode}`, url: href })
        })

        // Situs kayak gini sering nampilin episode terbaru di atas → urutin
        // ascending biar konsisten sama adapter lain
        return entries.sort((a, b) => a.episode - b.episode)
    },

    async resolveStream(episodeUrl: string, preferredQuality?: number | null): Promise<StreamResult> {
        const html = await fetchHtml(episodeUrl)
        const $ = cheerio.load(html)

        let iframe: string | null = null
        const mirrors: MirrorOption[] = []
        const availableQualities: number[] = []

        // ── Langkah 1: iframe player default yang langsung ke-embed di halaman ──
        // Tema kayak gini biasanya taro player utama di `#embed_holder iframe`
        // atau `.player-embed iframe`.
        const defaultIframe =
            $('#embed_holder iframe').attr('src') ??
            $('.player-embed iframe').attr('src') ??
            null
        if (defaultIframe) iframe = defaultIframe

        // ── Langkah 2: mirror quality selector ──
        // Samehadaku encode <iframe src="..."> langsung ke Base64 di value option.
        // Beberapa tema lain encode JSON untuk AJAX. Kita handle kedua kasus.
        $('select.mirror option, .mirrorstream option').each((_, el) => {
            const $opt = $(el)
            const label = $opt.text().trim()
            const raw = $opt.attr('value') ?? $opt.attr('data-content') ?? ''
            if (!raw) return

            let decoded = ''
            try {
                decoded = Buffer.from(raw, 'base64').toString('utf-8')
            } catch {
                return // bukan base64 valid
            }

            let content: Record<string, unknown> = {}

            if (decoded.includes('<iframe')) {
                // Pola Samehadaku: value = base64(<iframe src="URL" ...>)
                const srcMatch = decoded.match(/src=["']([^"']+)["']/)
                if (srcMatch) content = { iframeUrl: srcMatch[1] }
            } else {
                // Pola lain: value = base64(JSON)
                try {
                    content = JSON.parse(decoded)
                } catch {
                    return // bukan JSON valid juga → skip
                }
            }

            const qualityMatch = label.match(/(\d{3,4})p?/)
            const quality = qualityMatch ? qualityMatch[1] : 'auto'
            if (qualityMatch) availableQualities.push(parseInt(qualityMatch[1], 10))

            mirrors.push({ label, quality, content })
        })

        // ── Langkah 3: resolve mirror ke iframe URL ──
        if (mirrors.length > 0) {
            const target =
                (preferredQuality ? mirrors.find(m => m.quality === String(preferredQuality)) : undefined) ??
                mirrors[0]

            if (typeof target.content.iframeUrl === 'string') {
                // Pola Samehadaku: URL langsung tersedia, pakai langsung
                iframe = target.content.iframeUrl
            } else {
                // Pola lain: kirim AJAX ke admin-ajax.php buat dapetin iframe
                try {
                    const ajaxRes = await fetchWithDns(`${SAMEHADAKU_BASE}/wp-admin/admin-ajax.php`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            action: 'player_ajax',
                            ...Object.fromEntries(
                                Object.entries(target.content).map(([k, v]) => [k, String(v)]),
                            ),
                        }),
                    })
                    const ajaxHtml = await ajaxRes.text()
                    const $ajax = cheerio.load(ajaxHtml)
                    const resolvedSrc = $ajax('iframe').attr('src')
                    if (resolvedSrc) iframe = resolvedSrc
                } catch {
                    // AJAX gagal (mis. nonce expired) → tetep pake defaultIframe kalau ada
                }
            }
        }

        return {
            iframe,
            directUrl: null, // Samehadaku umumnya cuma kasih iframe, jarang direct .m3u8
            mirrors,
            resolved: iframe !== null,
            availableQualities: [...new Set(availableQualities)].sort((a, b) => b - a),
        }
    },
}

export { extractSlug as samehadakuExtractSlug }
