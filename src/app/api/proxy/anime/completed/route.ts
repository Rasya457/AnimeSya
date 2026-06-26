import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://wajik-anime-api.vercel.app/otakudesu'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const page = searchParams.get('page') ?? '1'

  try {
    // Ambil data dari 2 endpoint sekaligus: /home (untuk hero/banner)
    // dan /ongoing (dedicated + support pagination)
    const [homeRes, ongoingRes] = await Promise.all([
      fetch(`${BASE}/home`, { next: { revalidate: 300 } }),
      fetch(`${BASE}/ongoing?page=${page}`, { next: { revalidate: 300 } }),
    ])

    if (!homeRes.ok || !ongoingRes.ok) {
      throw new Error(
        `API error: home=${homeRes.status} ongoing=${ongoingRes.status}`
      )
    }

    const [homeJson, ongoingJson] = await Promise.all([
      homeRes.json(),
      ongoingRes.json(),
    ])

    // Response shape dari wajik-anime-api:
    // { statusCode, statusMessage, message, data: [...], pagination }
    const ongoingList: unknown[] = Array.isArray(ongoingJson?.data)
      ? ongoingJson.data
      : []

    // /home biasanya punya beberapa section, ambil semua yang relevan
    const homeData = homeJson?.data ?? {}
    const latestEpisode: unknown[] =
      homeData?.latestAnime ??
      homeData?.latestEpisode ??
      homeData?.recent ??
      []

    const completed: unknown[] =
      homeData?.completed ??
      homeData?.completedAnime ??
      []

    return NextResponse.json({
      success: true,
      data: {
        ongoing: ongoingList,        // dari /ongoing – paling akurat
        latestEpisode,               // episode terbaru dari /home
        completed,                   // anime tamat dari /home
      },
      pagination: ongoingJson?.pagination ?? null,
    })
  } catch (e) {
    console.error('[proxy/home]', e)
    return NextResponse.json(
      { success: false, data: { ongoing: [], latestEpisode: [], completed: [] }, pagination: null },
      { status: 500 }
    )
  }
}