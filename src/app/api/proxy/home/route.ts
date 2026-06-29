import { NextRequest, NextResponse } from 'next/server'
import { animeApi } from '@/lib/anime-api'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const page = searchParams.get('page') ?? '1'

  try {
    const { ongoing, completed } = await animeApi.home(page)

    return NextResponse.json({
      success: true,
      data: { ongoing, completed, latestEpisode: [] },
      pagination: {
        current: Number(page),
        last: 1,
        hasNext: false,
      },
    }, {
      headers: {
        // Cache di Vercel Edge 5 menit, stale-while-revalidate 10 menit
        // Cache di browser 1 menit (max-age=60) agar refresh atau navigasi cepat tidak berulang memanggil server
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    })
  } catch (error: any) {
    console.error('[proxy-home] GET error:', error)
    return NextResponse.json(
      { success: false, error: error.message ?? 'Internal Server Error' },
      { status: 500 }
    )
  }
}