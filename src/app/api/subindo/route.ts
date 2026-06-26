import { NextRequest, NextResponse } from 'next/server'

const JIKAN = 'https://api.jikan.moe/v4'
const UA    = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface IndoLink { name: string; color: string; url: string }

const HOST_COLORS: Record<string, string> = {
  'streamtape.com'  : '#f97316',
  'doodstream.com'  : '#a855f7',
  'dood.watch'      : '#a855f7',
  'mp4upload.com'   : '#3b82f6',
  'streamwish.com'  : '#ec4899',
  'filelions.com'   : '#14b8a6',
  'pixeldrain.com'  : '#eab308',
}
function hostColor(h: string) { return HOST_COLORS[h] ?? '#6366f1' }

// ─── helpers ───────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent'     : UA,
        'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
        'Referer'        : 'https://otakudesu.cloud/',
      },
      signal: AbortSignal.timeout(10_000),
      cache : 'no-store',
    })
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

async function getTitles(malId: string): Promise<{ title: string; titleEn: string } | null> {
  try {
    const r = await fetch(`${JIKAN}/anime/${malId}`, { next: { revalidate: 86400 } })
    if (!r.ok) return null
    const j = await r.json()
    return {
      title  : (j?.data?.title          ?? '') as string,
      titleEn: (j?.data?.title_english  ?? '') as string,
    }
  } catch { return null }
}

// ─── scraper steps ─────────────────────────────────────────────────────────

/** Search otakudesu → return first anime page URL */
async function findAnimeUrl(rawTitle: string): Promise<string | null> {
  // strip "Season N" / trailing year so search hits better
  const q = rawTitle.replace(/\s*season\s*\d+/i, '').replace(/\s*\(\d{4}\)$/, '').trim()
  const html = await fetchHtml(`https://otakudesu.cloud/?s=${encodeURIComponent(q)}`)
  if (!html) return null
  const m = html.match(/href="(https:\/\/otakudesu\.cloud\/anime\/[^"]+)"/)
  return m?.[1] ?? null
}

/** Anime page → episode N page URL */
async function findEpisodeUrl(animeUrl: string, ep: number): Promise<string | null> {
  const html = await fetchHtml(animeUrl)
  if (!html) return null

  // Primary: URL contains "-episode-N-" or "-episode-N/"
  const pat1 = new RegExp(
    `href="(https://otakudesu\\.cloud/episode/[^"]*-episode-${ep}(?:-[^"]*)?)"`, 'i'
  )
  const m1 = html.match(pat1)
  if (m1) return m1[1]

  // Fallback: collect all /episode/ links in DOM order, reverse (oldest first), pick index ep-1
  const all    = [...html.matchAll(/href="(https:\/\/otakudesu\.cloud\/episode\/[^"]+)"/g)]
  const unique = [...new Set(all.map(x => x[1]))].reverse()
  return unique[ep - 1] ?? null
}

/** Episode page → embeddable video URLs */
async function extractEmbeds(epUrl: string): Promise<IndoLink[]> {
  const html = await fetchHtml(epUrl)
  if (!html) return []

  const seen  = new Set<string>()
  const links: IndoLink[] = []

  function tryAdd(url: string) {
    if (!url || seen.has(url))                            return
    if (!url.startsWith('http'))                          return
    if (/\.(css|js|png|jpg|gif|svg|ico|woff)(\?|$)/.test(url)) return
    if (url.includes('otakudesu'))                        return
    if (url.includes('google') || url.includes('gstatic')) return
    try {
      const host = new URL(url).hostname.replace('www.', '')
      seen.add(url)
      links.push({ name: host, color: hostColor(host), url })
    } catch { /* invalid URL */ }
  }

  // 1. <iframe src="..."> and data-src / data-video / data-url / data-iframe
  const attrPat = /(?:src|data-src|data-video|data-url|data-iframe)="(https?:\/\/[^"]+)"/g
  for (const m of html.matchAll(attrPat)) tryAdd(m[1])

  // 2. Otakudesu mirror buttons — sometimes URLs live in onclick or a custom attribute
  const onclickPat = /onclick="[^"]*['`](https?:\/\/[^'`"]+)['`]/g
  for (const m of html.matchAll(onclickPat)) tryAdd(m[1])

  // 3. Plain href pointing to known streaming hosts
  const knownHosts = ['streamtape', 'doodstream', 'dood.', 'mp4upload', 'streamwish', 'filelions', 'pixeldrain']
  const hrefPat = /href="(https?:\/\/[^"]+)"/g
  for (const m of html.matchAll(hrefPat)) {
    if (knownHosts.some(h => m[1].includes(h))) tryAdd(m[1])
  }

  return links
}

// ─── route ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const malId = req.nextUrl.searchParams.get('malId') ?? ''
  const ep    = Number(req.nextUrl.searchParams.get('ep') ?? '0')

  if (!malId || !ep || isNaN(ep)) {
    return NextResponse.json({ error: 'malId dan ep wajib diisi' }, { status: 400 })
  }

  const titles = await getTitles(malId)
  if (!titles) {
    return NextResponse.json({ error: 'Anime tidak ditemukan di Jikan' }, { status: 404 })
  }

  // Try Japanese title first, fallback to English title
  const queries = [titles.title, titles.titleEn].filter(Boolean)
  let animeUrl: string | null = null
  for (const q of queries) {
    animeUrl = await findAnimeUrl(q)
    if (animeUrl) break
  }

  // Resolve episode URL and extract embeds
  const epUrl = animeUrl ? await findEpisodeUrl(animeUrl, ep) : null
  const links = epUrl    ? await extractEmbeds(epUrl)         : []

  // Always return 200 with empty links rather than erroring —
  // the client shows "Gagal memuat" only when links is missing/null, not empty array.
  return NextResponse.json({
    title  : titles.title,
    titleEn: titles.titleEn,
    episode: ep,
    links,
  })
}