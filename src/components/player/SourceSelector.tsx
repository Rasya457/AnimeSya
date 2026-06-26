'use client'

import type { StreamQuality, StreamSource } from '@/types/anime'

interface Props {
  streams: StreamQuality[]
  selectedQuality: string
  selectedProvider: string
  onSelect: (quality: string, source: StreamSource) => void
}

export function SourceSelector({
  streams,
  selectedQuality,
  selectedProvider,
  onSelect,
}: Props) {
  return (
    <div className="flex flex-wrap gap-3">
      {streams.map((q) => (
        <div key={q.quality} className="flex flex-col gap-1.5">
          <span className="text-xs text-zinc-400 font-medium">{q.quality}</span>
          <div className="flex flex-wrap gap-1.5">
            {q.sources.map((src) => {
              const active =
                selectedQuality === q.quality &&
                selectedProvider === src.provider
              return (
                <button
                  key={src.provider}
                  onClick={() => onSelect(q.quality, src)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    active
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {src.provider}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}   