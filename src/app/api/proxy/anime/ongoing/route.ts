import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://wajik-anime-api.vercel.app/otakudesu'

export async function GET(req: NextRequest) {
  try {
    const res  = await fetch(`${BASE}/home`)
    const json = await res.json()

    // Log supaya kelihatan shape-nya
    console.log('[proxy/home raw]', JSON.stringify(json?.data).slice(0, 300))

    // Coba beberapa kemungkinan field name
    const data =
      json?.data?.ongoingAnimeList ??
      json?.data?.ongoingAnime ??
      json?.data?.ongoing ??
      []

    return NextResponse.json({ success: true, data })
  } catch (e) {
    console.error('[proxy/ongoing]', e)
    return NextResponse.json({ success: false, data: [] }, { status: 500 })
  }
}