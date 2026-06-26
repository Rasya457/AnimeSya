import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  if (!q.trim()) return NextResponse.json({ success: true, data: [] })

  const res  = await fetch(
    `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=20&sfw=true`,
    { next: { revalidate: 300 } }
  )
  const json = await res.json()

  // Map ke format AnimeListItem yang dipakai AnimeCard
  const data = (json?.data ?? []).map((a: any) => ({
    animeId  : String(a.mal_id),
    title    : a.title,
    poster   : a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url ?? '',
    episode  : a.episodes ? `${a.episodes} eps` : a.status ?? '',
    score    : a.score ?? null,
    status   : a.status ?? '',
  }))

  return NextResponse.json({ success: true, data })
}