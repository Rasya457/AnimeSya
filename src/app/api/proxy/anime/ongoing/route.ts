import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://wajik-anime-api.vercel.app/otakudesu'

export async function GET(req: NextRequest) {
  try {
    const res  = await fetch(`${BASE}/home`, { next: { revalidate: 300 } })
    const json = await res.json()

    // Log supaya kelihatan shape-nya
    console.log('[proxy/home raw]', JSON.stringify(json?.data).slice(0, 300))

    // Coba beberapa kemungkinan field name
    const data =
      json?.data?.ongoingAnimeList ??
      json?.data?.ongoingAnime ??
      json?.data?.ongoing ??
      []

    return NextResponse.json({ success: true, data }, {
      headers: {
        // Cache di Vercel Edge 5 menit, stale 10 menit
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (e) {
    console.error('[proxy/ongoing]', e)
    return NextResponse.json({ success: false, data: [] }, { status: 500 })
  }
}