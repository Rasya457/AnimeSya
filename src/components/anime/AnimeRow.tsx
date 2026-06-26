import React, { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import type { AnimeListItem } from '@/types/anime'
import AnimeCard from './AnimeCard'

interface AnimeRowProps {
  title:             string
  animeList:         AnimeListItem[]
  showEpisodeBadge?: boolean
}

// Terjemahkan daysSinceUpdate → label + warna badge
function resolveUpdateBadge(days: number | undefined): { text: string; cls: string } | null {
  if (days === undefined) return null
  if (days === 0) return { text: 'HARI INI',    cls: 'bg-accent text-white' }
  if (days === 1) return { text: 'KEMARIN',     cls: 'bg-zinc-700 text-zinc-200' }
  if (days <= 3)  return { text: `${days} HR LALU`, cls: 'bg-zinc-800 text-zinc-400' }
  return null  // > 3 hari → tidak perlu badge
}

const AnimeRow: React.FC<AnimeRowProps> = ({
  title,
  animeList,
  showEpisodeBadge = false,
}) => {
  const rowRef = useRef<HTMLDivElement>(null)

  const scroll = (dir: 'left' | 'right') => {
    if (!rowRef.current) return
    const { scrollLeft, clientWidth } = rowRef.current
    rowRef.current.scrollTo({
      left: dir === 'left'
        ? scrollLeft - clientWidth * 0.75
        : scrollLeft + clientWidth * 0.75,
      behavior: 'smooth',
    })
  }

  if (!animeList.length) return null

  // Berapa anime yang tayang hari ini → ditampilkan di header
  const freshCount = showEpisodeBadge
    ? animeList.filter(a => (a as any).daysSinceUpdate === 0).length
    : 0

  return (
    <div className="flex flex-col gap-4 relative group/row w-full">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 md:px-12">
        <h3 className="text-lg md:text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2 flex-wrap">
          {title}
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />

          {/* "N baru hari ini" — hanya muncul kalau ada & row ini ongoing */}
          {freshCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent/10 border border-accent/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {freshCount} baru hari ini
            </span>
          )}
        </h3>

        <Link
          href="/browse"
          className="text-xs md:text-sm font-semibold text-accent hover:text-accent-hover flex items-center gap-1 bg-accent/10 px-3 py-1 rounded-full border border-accent/20"
        >
          All <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* ── Carousel ───────────────────────────────────────────────── */}
      <div className="relative w-full px-6 md:px-12 flex items-center">
        <button
          onClick={() => scroll('left')}
          className="absolute left-10 z-20 w-10 h-10 rounded-full border border-zinc-800/80 items-center justify-center cursor-pointer hover:bg-zinc-950/80 hover:text-accent shadow-lg opacity-0 group-hover/row:opacity-100 hidden md:flex transition-opacity focus:outline-none"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div
          ref={rowRef}
          data-lenis-prevent
          className="w-full flex items-center gap-5 overflow-x-auto scrollbar-hide scroll-smooth pb-4 px-1"
        >
          {animeList.map((anime) => {
            const ext      = anime as any
            const badge    = showEpisodeBadge ? resolveUpdateBadge(ext.daysSinceUpdate) : null
            const isToday  = showEpisodeBadge && ext.daysSinceUpdate === 0
            const curEp    = showEpisodeBadge ? ext.currentEpisode : undefined

            return (
              <div
                key={anime.animeId}
                className={[
                  'relative shrink-0 rounded-lg',
                  isToday ? 'ring-1 ring-accent/50' : '',
                ].join(' ')}
              >
                <AnimeCard
                  anime={anime}
                  showEpisodeBadge={showEpisodeBadge}
                />

                {/* Badge: HARI INI / KEMARIN / X HR LALU — pojok kiri atas */}
                {badge && (
                  <span className={`
                    absolute top-2 left-2 z-10
                    text-[10px] font-bold tracking-widest
                    px-1.5 py-0.5 rounded
                    pointer-events-none
                    ${badge.cls}
                  `}>
                    {badge.text}
                  </span>
                )}

                {/* Badge: Ep N — pojok kanan bawah (area poster, bukan teks) */}
                {curEp !== undefined && curEp !== '?' && (
                  <span className="
                    absolute bottom-[4.5rem] right-2 z-10
                    text-[11px] font-semibold text-white
                    bg-black/70 backdrop-blur-sm
                    px-1.5 py-0.5 rounded
                    pointer-events-none
                  ">
                    Ep {curEp}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <button
          onClick={() => scroll('right')}
          className="absolute right-10 z-20 w-10 h-10 rounded-full border border-zinc-800/80 items-center justify-center cursor-pointer hover:bg-zinc-950/80 hover:text-accent shadow-lg opacity-0 group-hover/row:opacity-100 hidden md:flex transition-opacity focus:outline-none"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}

export default AnimeRow