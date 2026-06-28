import { NextRequest, NextResponse } from 'next/server'

const JIKAN_BASE = 'https://api.jikan.moe/v4'

async function jikanFetch(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, { next: { revalidate: 300 } })

    // Rate limited — tunggu sebentar lalu retry
    if (res.status === 429) {
      if (i < retries) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)))
        continue
      }
      return null
    }

    if (!res.ok) return null
    return res.json()
  }
  return null
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  if (!q.trim()) return NextResponse.json({ success: true, data: [] })

  const json = await jikanFetch(
    `${JIKAN_BASE}/anime?q=${encodeURIComponent(q)}&limit=25&sfw=true&order_by=popularity&sort=asc`
  )

  if (!json) {
    return NextResponse.json(
      { success: false, error: 'Jikan rate limit atau error', data: [] },
      { status: 503 }
    )
  }

  const data = (json?.data ?? []).map((a: any) => ({
    animeId : String(a.mal_id),
    title   : a.title,
    poster  : a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
    episode : a.episodes ? `${a.episodes} eps` : a.status ?? '',
    score   : a.score ?? null,
    status  : a.status ?? '',
  }))

  return NextResponse.json({ success: true, data })
}