'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { AnimeListItem } from '@/types/anime'

// Cache module-level, shared antar komponen dalam satu sesi
interface CacheData {
  ongoing:   AnimeListItem[]
  completed: AnimeListItem[]
}

const CACHE_TTL = 5 * 60 * 1000 // 5 menit
let _cache:     CacheData | null        = null
let _cacheTime: number                  = 0
let _promise:   Promise<CacheData> | null = null

function dedup(list: AnimeListItem[]): AnimeListItem[] {
  return Array.from(new Map(list.map((a) => [a.animeId, a])).values())
}

async function fetchHomeData(): Promise<CacheData> {
  const isFresh = _cache && Date.now() - _cacheTime < CACHE_TTL
  if (isFresh)  return _cache!
  if (_promise) return _promise

  _promise = fetch('/api/proxy/home')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!json?.success) throw new Error('API returned success: false')

      const data: CacheData = {
        ongoing:   dedup(Array.isArray(json.data?.ongoing)   ? json.data.ongoing   : []),
        completed: dedup(Array.isArray(json.data?.completed) ? json.data.completed : []),
      }

      _cache     = data
      _cacheTime = Date.now()
      _promise   = null
      return data
    })
    .catch((e) => {
      _promise = null
      console.error('[useAnime]', e)
      throw e
    })

  return _promise
}

// ─── Hook ─────────────────────────────────────────────────────────────────

interface UseAnimeReturn {
  ongoing:     AnimeListItem[]
  completed:   AnimeListItem[]
  animeList:   AnimeListItem[]
  allGenres:   string[]
  hero:        AnimeListItem | null
  loading:     boolean
  error:       string | null
  searchAnime: (query: string) => AnimeListItem[]
  getById:     (animeId: string) => AnimeListItem | undefined
}

export function useAnime(): UseAnimeReturn {
  const [ongoing,   setOngoing]   = useState<AnimeListItem[]>(_cache?.ongoing   ?? [])
  const [completed, setCompleted] = useState<AnimeListItem[]>(_cache?.completed ?? [])
  const [loading,   setLoading]   = useState(!_cache)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    const isFresh = _cache && Date.now() - _cacheTime < CACHE_TTL
    if (isFresh) return

    fetchHomeData()
      .then(({ ongoing, completed }) => {
        setOngoing(ongoing)
        setCompleted(completed)
      })
      .catch(() => setError('Gagal memuat anime. Coba refresh.'))
      .finally(() => setLoading(false))
  }, [])

  const animeList = useMemo(() => {
    const seen = new Set<string>()
    return [...ongoing, ...completed].filter((a) => {
      if (seen.has(a.animeId)) return false
      seen.add(a.animeId)
      return true
    })
  }, [ongoing, completed])

  const allGenres = useMemo(() => {
    const genres = animeList.flatMap((a: any) => a.genres ?? [])
    return [...new Set(genres)] as string[]
  }, [animeList])

  const searchAnime = useCallback(
    (query: string): AnimeListItem[] => {
      if (!query.trim()) return []
      const q = query.toLowerCase()
      return animeList.filter((a) => a.title?.toLowerCase().includes(q))
    },
    [animeList]
  )

  const getById = useCallback(
    (animeId: string) => animeList.find((a) => a.animeId === animeId),
    [animeList]
  )

  return {
    ongoing,
    completed,
    animeList,
    allGenres,
    hero: ongoing[0] ?? null,
    loading,
    error,
    searchAnime,
    getById,
  }
}