import Link from 'next/link'

interface Props {
  prevEpisode: string | null
  nextEpisode: string | null
  animeSlug: string
}

export function EpisodeNav({ prevEpisode, nextEpisode, animeSlug }: Props) {
  return (
    <div className="flex items-center justify-between gap-4">
      {prevEpisode ? (
        <Link
          href={`/watch/${prevEpisode}`}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors"
        >
          ← Episode Sebelumnya
        </Link>
      ) : (
        <div />
      )}

      <Link
        href={`/anime/${animeSlug}`}
        className="text-sm text-zinc-400 hover:text-white transition-colors"
      >
        Semua Episode
      </Link>

      {nextEpisode ? (
        <Link
          href={`/watch/${nextEpisode}`}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm text-white transition-colors"
        >
          Episode Berikutnya →
        </Link>
      ) : (
        <div />
      )}
    </div>
  )
}