import { NextRequest, NextResponse } from 'next/server'
import { animeApi, AnimeNotIndexedError } from '@/lib/anime-api'

// ─────────────────────────────────────────────────────────────────────────────
// FIX (Jul 2026): Route ini SEBELUMNYA fetch langsung ke Jikan API pakai
// `animeId` mentah — cuma jalan kalau animeId berupa MAL ID numerik. Begitu
// WatchClient dikasih slug Otakudesu (anime yang belum ke-index di MAL,
// misal "grand-blue-s3-sub-indo"), fetch ke
// `api.jikan.moe/v4/anime/grand-blue-s3-sub-indo` otomatis gagal → 404/500.
//
// `animeApi.detail()` (dipakai juga di halaman /anime/[slug]) sudah punya
// logic lengkap buat kasus ini: kalau animeId bukan angka, dia coba resolve
// ke MAL ID lewat pencarian judul; kalau gak ketemu match, fallback ke data
// Otakudesu doang (buildFallbackDetail). Route ini sekarang delegasi penuh
// ke situ biar behavior halaman detail & halaman watch selalu konsisten,
// gak ada 2 sumber logic yang bisa nyimpang lagi.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ animeId: string }> }
) {
  const { animeId } = await params

  try {
    const anime = await animeApi.detail(animeId)
    return NextResponse.json(
      {
        statusCode: 200,
        statusMessage: 'OK',
        data: anime,
        pagination: null,
      },
      {
        headers: {
          // Detail anime jarang berubah — cache 1 jam, stale 24 jam
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    )
  } catch (err) {
    if (err instanceof AnimeNotIndexedError) {
      // Anime beneran gak ketemu di mana pun (Otakudesu maupun MAL) —
      // ini kasus yang sah buat dianggap 404, beda dari error jaringan.
      return NextResponse.json(
        { statusCode: 404, statusMessage: 'Not Found', data: null, pagination: null },
        { status: 404 }
      )
    }

    console.error(`[proxy-anime] Gagal ambil detail untuk "${animeId}":`, err)
    return NextResponse.json(
      { statusCode: 500, statusMessage: 'Internal Error', data: null, pagination: null },
      { status: 500 }
    )
  }
}