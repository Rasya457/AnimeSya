import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://wajik-anime-api.vercel.app/otakudesu'

// ─── Caching System ───────────────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const _cache = new Map<string, CacheEntry<any>>()

function cacheGet<T>(key: string): T | null {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key)
    return null
  }
  return entry.data as T
}

function cacheSet<T>(key: string, data: T, ttlMs = 5 * 60 * 1000) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export async function GET(req: NextRequest) {
  const episodeId = req.nextUrl.searchParams.get('episodeId') ?? ''
  if (!episodeId.trim()) {
    return NextResponse.json({ success: false, data: null }, { status: 400 })
  }

  // Check cache first
  const cacheKey = `megaplay:${episodeId}`
  const cachedData = cacheGet<any>(cacheKey)
  if (cachedData) {
    return NextResponse.json(cachedData)
  }

  try {
    const res = await fetch(`${BASE}/episode/${encodeURIComponent(episodeId)}`, {
      signal: AbortSignal.timeout(8000)
    })
    const json = await res.json()

    if (!res.ok || !json?.data) {
      return NextResponse.json({ success: false, data: null }, { status: 404 })
    }

    const d = json.data

    // wajik-anime-api mengembalikan defaultStreamingUrl sebagai URL utama Megaplay
    const streamUrl: string | null = d.defaultStreamingUrl ?? d.streamUrl ?? null

    // downloadUrl berisi array resolusi: { quality, url }[]
    const downloadUrls: { quality: string; url: string }[] =
      Array.isArray(d.downloadUrl) ? d.downloadUrl : []

    const responseData = {
      success: true,
      data: {
        episodeId,
        streamUrl,
        downloadUrls,
        title: d.episode ?? episodeId,
      },
    }

    // Cache the successful response for 5 minutes
    cacheSet(cacheKey, responseData, 5 * 60 * 1000)

    return NextResponse.json(responseData)
  } catch (e) {
    console.error('[megaplay]', e)
    return NextResponse.json({ success: false, data: null }, { status: 500 })
  }
}