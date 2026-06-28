import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Play } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { AnimeListItem } from '@/types/anime'

interface AnimeCardProps {
  anime: AnimeListItem
  showEpisodeBadge?: boolean
  /**
   * 'carousel' (default) — lebar fixed (w-40 md:w-48) + shrink-0, untuk
   *   dipakai di dalam horizontal scroll row (flex overflow-x-auto).
   * 'grid' — lebar penuh (w-full), untuk dipakai sebagai item grid
   *   (mis. halaman search) di mana lebar diatur oleh grid column-nya.
   */
  variant?: 'carousel' | 'grid'
}

const AnimeCard: React.FC<AnimeCardProps> = ({ anime, showEpisodeBadge = false, variant = 'carousel' }) => {
  const widthClass = variant === 'grid' ? 'w-full' : 'w-40 md:w-48 shrink-0'

  return (
    <Link
      href={`/anime/${anime.animeId}`}
      prefetch={false}
      className={`group relative flex flex-col ${widthClass} rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-900/60 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] md:hover:-translate-y-1 md:hover:border-accent/40 md:hover:shadow-[0_12px_40px_rgba(0,0,0,0.8),_0_0_20px_rgba(16,185,129,0.1)] focus:outline-none`}
    >
      {/* Poster */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-900">
        {anime.poster ? (
          <Image
            src={anime.poster}
            alt={anime.title ?? ''}
            fill
            sizes="(max-width: 768px) 160px, 192px"
            className="object-cover md:group-hover:scale-106 transition-transform duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]"
          />
        ) : (
          <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
            <span className="text-zinc-600 text-xs">No Image</span>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

        {/* Play button on hover */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 md:group-hover:opacity-100 transition-opacity duration-300">
          <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center scale-90 md:group-hover:scale-100 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
            <Play className="w-5 h-5 text-zinc-950 fill-zinc-950 translate-x-[2px]" />
          </div>
        </div>

        {/* Episode badge */}
        {showEpisodeBadge && anime.episodes && (
          <div className="absolute bottom-3 left-3 z-10">
            <Badge variant="accent">Ep {anime.episodes}</Badge>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3.5 flex flex-col gap-1">
        <h4 className="text-sm font-bold text-zinc-100 truncate group-hover:text-accent transition-colors">
          {anime.title}
        </h4>
        <p className="text-[11px] text-zinc-500 font-medium truncate">
          {anime.releaseDay
            ? `Tayang ${anime.releaseDay}`
            : anime.latestReleaseDate ?? ''}
        </p>
      </div>
    </Link>
  )
}

export default AnimeCard