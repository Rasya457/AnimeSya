'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Search as SearchIcon, AlertCircle, Sparkles, Loader2 } from 'lucide-react'
import { useAnime } from '@/hooks/useAnime'
import AnimeCard from '@/components/anime/AnimeCard'
import type { AnimeListItem } from '@/types/anime'

function SearchContent() {
  const searchParams  = useSearchParams()
  const initialQuery  = searchParams.get('q') || ''

  // Pool rekomendasi: gabungan ongoing + completed (deduped) dari useAnime
  const { animeList } = useAnime()

  const [searchQuery,    setSearchQuery]    = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery)
  const [results,        setResults]        = useState<AnimeListItem[]>([])
  const [searching,      setSearching]      = useState(false)
  const [recommendedAnime, setRecommendedAnime] = useState<AnimeListItem[]>([])

  useEffect(() => {
    setSearchQuery(initialQuery)
    setDebouncedQuery(initialQuery)
  }, [initialQuery])

  // Debounce 400ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 400)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Tiap kali halaman di-refresh/mount, acak urutan anime (ongoing + completed,
  // pool lebih besar) supaya user dapat pilihan berbeda setiap kunjungan,
  // dan tampilkan lebih banyak (18).
  useEffect(() => {
    if (animeList.length === 0) return
    const shuffled = [...animeList].sort(() => Math.random() - 0.5)
    setRecommendedAnime(shuffled.slice(0, 18))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeList.length])


  // Search
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([])
      return
    }

    let cancelled = false

    async function doSearch() {
      setSearching(true)
      try {
        const res  = await fetch(`/api/proxy/anime/search?q=${encodeURIComponent(debouncedQuery)}`)
        const json = await res.json()

        // ✅ fix: response ada di json.data.animeList, bukan json.data langsung
        const list = json?.data?.animeList ?? json?.data ?? []
        if (!cancelled) {
          const arr = Array.isArray(list) ? list : []
          const seen = new Set<string>()
          const uniqueList = arr.filter(item => {
            if (!item || !item.animeId) return false
            if (seen.has(item.animeId)) return false
            seen.add(item.animeId)
            return true
          })
          setResults(uniqueList)
        }
      } catch (e) {
        console.error('[search] error:', e)
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }

    doSearch()
    return () => { cancelled = true }
  }, [debouncedQuery])

  const showRecs         = debouncedQuery.trim().length === 0

  return (
    <div className="w-full px-3 sm:px-6 md:px-12 py-8 flex flex-col gap-8 select-none overflow-x-hidden">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex items-center gap-2.5">
          <SearchIcon className="w-5 h-5 text-accent" />
          Find Anime
        </h2>
        <p className="text-xs text-zinc-500">Search by name, Japanese titles, or genres</p>
      </div>

      {/* Search Input */}
      <div className="relative w-full max-w-2xl">
        <label htmlFor="search-input" className="sr-only">Search Anime</label>
        <input
          id="search-input"
          type="text"
          placeholder="Search for demon slayer, romance, action..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-14 pl-12 pr-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-accent/60 focus:bg-zinc-900/60 transition-all backdrop-blur-sm"
        />
        {searching
          ? <Loader2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-accent animate-spin" />
          : <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
        }
      </div>

      {showRecs ? (
        <div className="flex flex-col gap-4">
          <h4 className="text-sm font-bold text-zinc-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent animate-pulse" />
            Recommended Anime
          </h4>
          {recommendedAnime.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6">
              {recommendedAnime.map((anime) => (
                <div key={anime.animeId} className="w-full min-w-0">
                  <AnimeCard anime={anime} showEpisodeBadge variant="grid" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-zinc-600 animate-spin" />
            </div>
          )}
        </div>
      ) : results.length > 0 ? (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          <h4 className="text-sm font-bold text-zinc-400">
            Results for &ldquo;{debouncedQuery}&rdquo; — {results.length} anime
          </h4>
          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6">
            {results.map((anime) => (
              <div key={anime.animeId} className="w-full min-w-0">
                <AnimeCard anime={anime} showEpisodeBadge variant="grid" />
              </div>
            ))}
          </div>
        </div>
      ) : !searching ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center text-zinc-500">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-base font-bold text-zinc-300">No results found</h4>
            <p className="text-xs text-zinc-500 max-w-xs">
              Couldn&apos;t find anime matching &ldquo;{debouncedQuery}&rdquo;. Try another keyword.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="w-full px-6 md:px-12 py-8 text-zinc-400 animate-pulse text-sm">
        Loading Search...
      </div>
    }>
      <SearchContent />
    </Suspense>
  )
}