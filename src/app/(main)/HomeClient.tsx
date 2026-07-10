'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Play, Bookmark, ChevronLeft, ChevronRight, Trash2, Clock } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { Badge } from '@/components/ui/Badge'
import AnimeRow from '@/components/anime/AnimeRow'
import type { AnimeListItem } from '@/types/anime'
import { getHistoryKey } from '@/lib/historyKey'
import { loadPositionPercent } from '@/lib/watchPosition'

const SCROLL_BTN =
  'w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 ' +
  'flex items-center justify-center text-zinc-400 ' +
  'hover:text-white hover:border-zinc-600 transition-all active:scale-90'

export interface HistoryItem {
  malId:            string
  title:            string
  poster:           string | undefined
  episode:          number
  watchedAt:        number
  progress?:        number        // seek position 0–100
  totalEpisodes?:   number
  watchedEpisodes?: number[]
}

// Shuffle deterministik berbasis seed (misal tanggal) — biar urutan row
// "acak" tapi stabil sepanjang hari itu (gak lompat-lompat tiap re-render
// atau tiap pindah halaman terus balik lagi).
function seededShuffle<T>(arr: T[], seed: string): T[] {
  const a = [...arr]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const rand = () => {
    h = (h * 1664525 + 1013904223) >>> 0
    return h / 4294967296
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Fetch daftar anime by genre dari /api/proxy/genre/[genreId] — dipakai buat
// row "Rekomendasi Romance" & "Rekomendasi Action". Beda dari romanceAnime
// versi lama yang nyaring dari `ongoing`+`completed` (yang datanya emang gak
// punya field genre sama sekali dari /home), endpoint genre ini scrape
// langsung halaman /genres/{slug}/ Otakudesu jadi hasilnya jauh lebih lengkap.
// Fetch 2 genre sekaligus secara paralel — lebih cepat dari 2 hook terpisah
// (dulu race condition: kedua fetch jalan di waktu berbeda, sekarang 1 Promise.all)
function useGenresAnime(genreIds: string[], excludeIds: Set<string>) {
  const [rawMap, setRawMap] = useState<Record<string, any[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const results = await Promise.all(
          genreIds.map(id =>
            fetch(`/api/proxy/genre/${id}?page=1`)
              .then(r => r.json())
              .then(j => ({ id, data: Array.isArray(j?.data) ? j.data : [] }))
              .catch(() => ({ id, data: [] }))
          )
        )
        if (cancelled) return
        const map: Record<string, any[]> = {}
        for (const { id, data } of results) map[id] = data
        setRawMap(map)
      } catch {
        if (!cancelled) setRawMap({})
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreIds.join(',')])

  const lists = useMemo(() => {
    const todayDate = new Date().toISOString().slice(0, 10)
    const result: Record<string, any[]> = {}
    for (const id of genreIds) {
      const pool = (rawMap[id] ?? []).filter((a: any) => a?.animeId && !excludeIds.has(a.animeId))
      result[id] = seededShuffle(pool, `${todayDate}-${id}`).slice(0, 30)
    }
    return result
  }, [rawMap, excludeIds, genreIds])

  return { lists, loading }
}

function useDragScroll(scrollPx = 320) {
  const ref   = useRef<HTMLDivElement>(null)
  const start = useRef<number | null>(null)
  const base  = useRef(0)

  const end          = () => { start.current = null }
  const onMouseDown  = (e: React.MouseEvent<HTMLDivElement>) => {
    start.current = e.clientX; base.current = ref.current?.scrollLeft ?? 0
  }
  const onMouseMove  = (e: React.MouseEvent<HTMLDivElement>) => {
    if (start.current == null || !ref.current) return
    ref.current.scrollLeft = base.current - (e.clientX - start.current)
  }
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    start.current = e.touches[0].clientX; base.current = ref.current?.scrollLeft ?? 0
  }
  const onTouchMove  = (e: React.TouchEvent<HTMLDivElement>) => {
    if (start.current == null || !ref.current) return
    ref.current.scrollLeft = base.current - (e.touches[0].clientX - start.current)
  }
  const scrollBy = (dir: 'l' | 'r') =>
    ref.current?.scrollBy({ left: dir === 'l' ? -scrollPx : scrollPx, behavior: 'smooth' })

  return {
    ref, scrollBy,
    handlers: {
      onMouseDown, onMouseMove, onMouseUp: end, onMouseLeave: end,
      onTouchStart, onTouchMove, onTouchEnd: end,
    },
  }
}

function useWatchHistory(userId?: string | null) {
  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    const key = getHistoryKey(userId)
    try {
      const raw = localStorage.getItem(key)
      if (!raw) { setHistory([]); return }
      const parsed: HistoryItem[] = JSON.parse(raw)
      const grouped = new Map<string, HistoryItem>()
      for (const item of parsed) {
        const existing = grouped.get(item.malId)
        if (!existing) {
          grouped.set(item.malId, { ...item, watchedEpisodes: item.watchedEpisodes ?? [item.episode] })
        } else {
          const merged = [...new Set([
            ...(existing.watchedEpisodes ?? [existing.episode]),
            ...(item.watchedEpisodes     ?? [item.episode]),
          ])]
          grouped.set(item.malId,
            item.watchedAt >= existing.watchedAt
              ? { ...item,     watchedEpisodes: merged, progress: Math.max(item.progress ?? 0, existing.progress ?? 0) }
              : { ...existing, watchedEpisodes: merged, progress: Math.max(item.progress ?? 0, existing.progress ?? 0) }
          )
        }
      }
      const deduped = Array.from(grouped.values()).sort((a, b) => b.watchedAt - a.watchedAt)
      localStorage.setItem(key, JSON.stringify(deduped))
      setHistory(deduped)
    } catch { }
  }, [userId])

  useEffect(() => {
    const key = getHistoryKey(userId)
    const sync = (e: StorageEvent) => {
      if (e.key !== key) return
      try { setHistory(e.newValue ? JSON.parse(e.newValue) : []) } catch { }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [userId])

  const clear  = useCallback(() => {
    const key = getHistoryKey(userId)
    localStorage.removeItem(key)
    setHistory([])
  }, [userId])

  const remove = useCallback((malId: string) => {
    const key = getHistoryKey(userId)
    const next = (JSON.parse(localStorage.getItem(key) ?? '[]') as HistoryItem[])
      .filter(h => h.malId !== malId)
    localStorage.setItem(key, JSON.stringify(next))
    setHistory(next)
  }, [userId])

  return { history, clear, remove }
}

interface HomeClientProps {
  ongoing: AnimeListItem[]
  completed: AnimeListItem[]
}

export default function HomeClient({ ongoing, completed }: HomeClientProps) {
  const { user } = useAuthStore()
  const { history, clear, remove } = useWatchHistory(user?.id)

  const heroList: AnimeListItem[] = ongoing.slice(0, 6)
  const [heroIdx,    setHeroIdx]    = useState(0)
  const [fading,     setFading]     = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const autoRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopAuto = () => { if (autoRef.current) clearInterval(autoRef.current) }

  const { ref: historyRef, handlers: historyDrag, scrollBy: scrollHistory } = useDragScroll(300)

  const currentHero   = heroList[heroIdx]
  const heroCurrentEp = (currentHero as any)?.currentEpisode

  const jumpTo = useCallback((idx: number) => {
    if (fading) return
    stopAuto()
    setFading(true)
    setTimeout(() => { setHeroIdx(idx); setBookmarked(false); setFading(false) }, 280)
  }, [fading])

  const next = useCallback(() => jumpTo((heroIdx + 1) % heroList.length), [heroIdx, heroList.length, jumpTo])
  const prev = useCallback(() => jumpTo((heroIdx - 1 + heroList.length) % heroList.length), [heroIdx, heroList.length, jumpTo])

  useEffect(() => {
    if (heroList.length <= 1) return
    autoRef.current = setInterval(next, 5000)
    return stopAuto
  }, [next, heroList.length])

  useEffect(() => { setBookmarked(false) }, [heroIdx])

  // Urutan `ongoing` sudah sesuai urutan update terbaru dari scraper Otakudesu
  // (paling atas = paling baru di-update). Jangan diacak lagi supaya jadwal
  // "New Update" di homepage konsisten sama jadwal asli Otakudesu/Sokuja.
  const newUpdateAnime = useMemo(() => ongoing.slice(0, 20), [ongoing])

  // Id yang udah ada di "Terakhir Ditonton" — dipakai buat exclude dari kedua
  // row rekomendasi di bawah, biar gak nyaranin ulang anime yang lagi/udah
  // ditonton.
  const historyIds = useMemo(() => new Set(history.map(h => h.malId)), [history])

  const GENRE_IDS = useMemo(() => ['romance', 'action'], [])
  const { lists: genreLists } = useGenresAnime(GENRE_IDS, historyIds)
  const romanceAnime = genreLists['romance'] ?? []
  const actionAnime  = genreLists['action']  ?? []

  if (!currentHero) return null

  return (
    <div className="flex flex-col gap-8 pb-16 w-full select-none">

      {/* ══ 1. HERO ══════════════════════════════════════════════ */}
      <section
        className="relative w-full overflow-hidden"
        style={{ height: '65vw', maxHeight: '560px', minHeight: '300px' }}
      >
        <div className="absolute inset-0">
          {heroList.map((a, i) => (
            <Link
              key={a.animeId ?? i}
              href={`/anime/${a.animeId}`}
              aria-label={a.title ?? 'Lihat detail anime'}
              className="absolute inset-0 transition-opacity duration-500"
              style={{ opacity: i === heroIdx ? 1 : 0, pointerEvents: i === heroIdx ? 'auto' : 'none' }}
            >
              <Image
                src={a.poster ?? ''}
                alt={a.title ?? ''}
                fill
                sizes="100vw"
                priority={i === 0}
                className="object-cover object-top"
              />
            </Link>
          ))}
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
        </div>

        <div
          className="absolute bottom-0 left-0 right-0 px-4 md:px-8 pb-5 flex flex-col gap-2"
          style={{
            opacity:    fading ? 0 : 1,
            transform:  fading ? 'translateY(6px)' : 'translateY(0)',
            transition: 'opacity 0.25s ease, transform 0.25s ease',
          }}
        >
          <div className="flex items-center gap-1.5">
            <Badge variant="accent" className="text-[9px] px-2 py-0.5 font-bold">
              {heroCurrentEp && heroCurrentEp !== '?'
                ? `Ep ${heroCurrentEp}${currentHero.episodes ? ` / ${currentHero.episodes}` : ''}`
                : `${currentHero.episodes ?? '?'} Eps`}
            </Badge>
            <span className="text-[9px] text-zinc-500 font-medium">{currentHero.releaseDay}</span>
          </div>
          <h1 className="text-lg sm:text-2xl md:text-3xl font-black text-white leading-tight line-clamp-2 max-w-[65%] drop-shadow-lg">
            {currentHero.title}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Link
              href={`/anime/${currentHero?.animeId}`}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-xs font-bold hover:opacity-90 active:scale-95 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              Tonton Sekarang
            </Link>
            <button
              onClick={() => setBookmarked(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/50 backdrop-blur-sm text-xs text-zinc-300 hover:text-white transition-all"
            >
              <Bookmark className={`w-3.5 h-3.5 ${bookmarked ? 'fill-accent text-accent' : ''}`} />
              {bookmarked ? 'Tersimpan' : 'Simpan'}
            </button>
          </div>
        </div>

        <button onClick={prev} aria-label="Hero sebelumnya" className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-zinc-900/60 border border-zinc-700/40 flex items-center justify-center text-zinc-400 hover:text-white backdrop-blur-sm transition-all">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={next} aria-label="Hero berikutnya" className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-zinc-900/60 border border-zinc-700/40 flex items-center justify-center text-zinc-400 hover:text-white backdrop-blur-sm transition-all">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        <div className="absolute bottom-3 right-4 flex items-center gap-1">
          {heroList.map((_, i) => (
            <button
              key={i}
              onClick={() => jumpTo(i)}
              aria-label={`Pilih anime hero ke-${i + 1}`}
              className="rounded-full transition-all duration-300"
              style={{
                width:      i === heroIdx ? '1rem' : '0.3rem',
                height:     '0.3rem',
                background: i === heroIdx
                  ? 'var(--color-accent, #e11d48)'
                  : 'rgba(161,161,170,0.45)',
              }}
            />
          ))}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-zinc-800/60">
          <div className="h-full bg-accent/60 transition-none" style={{ width: '100%', animation: 'none' }} />
        </div>
      </section>

      {/* ══ 2. TERAKHIR DITONTON ═════════════════════════════════ */}
      <section className="w-full px-4 md:px-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base md:text-lg font-black text-white">Terakhir Ditonton</h2>
          {history.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => scrollHistory('l')} className={SCROLL_BTN}><ChevronLeft  className="w-3 h-3" /></button>
              <button onClick={() => scrollHistory('r')} className={SCROLL_BTN}><ChevronRight className="w-3 h-3" /></button>
              <button onClick={clear} title="Hapus riwayat" className={`${SCROLL_BTN} hover:!text-red-400 hover:!border-red-900`}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {history.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/60 border border-zinc-800/50">
            <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-zinc-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-zinc-400">Belum ada riwayat</p>
              <p className="text-[10px] text-zinc-600">Tonton anime dan langsung muncul di sini</p>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div
            ref={historyRef}
            data-lenis-prevent
            className="flex flex-nowrap gap-3 cursor-grab active:cursor-grabbing"
            style={{
              overflowX: 'auto', overflowY: 'hidden',
              scrollbarWidth: 'none', msOverflowStyle: 'none',
              scrollSnapType: 'x mandatory', touchAction: 'pan-x',
              paddingBottom: '4px',
            }}
            {...historyDrag}
          >
            {history.map((item) => (
              <HistoryCard key={item.malId} item={item} onRemove={remove} />
            ))}
          </div>
        )}
      </section>

      {/* ══ 3. NEW UPDATE ════════════════════════════════════════ */}
      {newUpdateAnime.length > 0 && (
        <section className="w-full">
          <AnimeRow title="New Update Anime" animeList={newUpdateAnime} showEpisodeBadge />
        </section>
      )}

      {/* ══ 4. COMPLETED ═════════════════════════════════════════ */}
      {completed.length > 0 && (
        <section className="w-full">
          <AnimeRow title="Completed Anime" animeList={completed} showEpisodeBadge />
        </section>
      )}

      {/* ══ 5. REKOMENDASI ROMANCE ═══════════════════════════════ */}
      {romanceAnime.length > 0 && (
        <section className="w-full">
          <AnimeRow title="Rekomendasi Romance" animeList={romanceAnime} />
        </section>
      )}

      {/* ══ 6. REKOMENDASI ACTION ════════════════════════════════ */}
      {actionAnime.length > 0 && (
        <section className="w-full">
          <AnimeRow title="Rekomendasi Action" animeList={actionAnime} />
        </section>
      )}
    </div>
  )
}

function HistoryCard({ item, onRemove }: { item: HistoryItem; onRemove: (malId: string) => void }) {
  const watchedCount = item.watchedEpisodes?.length ?? 1

  const effectiveProgress = (() => {
    // Prioritas #1: posisi detik akurat (seconds/duration) dari server 'indo'
    // — ini sumber paling presisi karena langsung dari currentTime video-nya,
    // sama persis yang dipakai buat resume-exact di halaman nonton.
    const accurate = loadPositionPercent(item.malId, item.episode)
    if (accurate != null) return accurate >= 95 ? 100 : accurate

    if (item.progress != null && item.progress > 0) {
      const pct = item.progress <= 1
        ? Math.round(item.progress * 100)
        : Math.round(item.progress)
      return pct >= 95 ? 100 : pct
    }
    const total = item.totalEpisodes ?? 0
    if (total > 0) {
      const watched   = item.watchedEpisodes?.length ?? 0
      const numerator = watched > 0 ? watched : item.episode
      return Math.round((numerator / total) * 100)
    }
    const watched = item.watchedEpisodes?.length ?? 0
    if (watched > 1) return Math.min(watched * 8, 80)
    return 25
  })()

  return (
    <div className="group relative" style={{ width: '200px', minWidth: '200px', flexShrink: 0, scrollSnapAlign: 'start' }}>
      <Link href={`/watch/${item.malId}/${item.episode}`} draggable={false}>
        <div className="relative w-full rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/50" style={{ aspectRatio: '16/9' }}>
          {item.poster ? (
            <Image
              src={item.poster}
              alt={item.title}
              fill
              sizes="200px"
              className="object-cover object-top transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full bg-zinc-800" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/85 via-zinc-950/10 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="w-10 h-10 rounded-full bg-white/15 backdrop-blur border border-white/20 flex items-center justify-center">
              <Play className="w-4 h-4 fill-white text-white ml-0.5" />
            </div>
          </div>
          <div className="absolute left-2 flex items-center gap-1" style={{ bottom: '10px' }}>
            <span className="text-[10px] font-black text-white bg-accent/90 rounded px-2 py-0.5 leading-none">
              EP {item.episode}
            </span>
            {watchedCount > 1 && (
              <span className="text-[10px] font-semibold text-zinc-300 bg-zinc-950/80 rounded px-1.5 py-0.5 leading-none">
                +{watchedCount - 1} ep
              </span>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0" style={{ height: '5px', backgroundColor: 'rgba(39,39,42,0.8)' }}>
            <div
              className="transition-all duration-500 ease-out"
              style={{ width: `${effectiveProgress}%`, height: '5px', backgroundColor: '#22c55e' }}
            />
          </div>
        </div>
        <p
          className="mt-2 text-xs font-bold text-zinc-300 group-hover:text-accent transition-colors px-0.5 leading-snug"
          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.6em' }}
        >
          {item.title}
        </p>
      </Link>
      <button
        onClick={() => onRemove(item.malId)}
        aria-label={`Hapus ${item.title} dari riwayat menonton`}
        title={`Hapus ${item.title} dari riwayat menonton`}
        className="absolute top-2 right-2 w-6 h-6 rounded-md bg-black/70 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500/80 transition-all active:scale-90"
      >
        <Trash2 className="w-3 h-3 text-white" />
      </button>
    </div>
  )
}
