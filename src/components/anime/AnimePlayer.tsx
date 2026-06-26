'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, AlertCircle, Play, RefreshCw, ExternalLink } from 'lucide-react'

interface StreamData {
  episodeId:    string
  streamUrl:    string | null
  downloadUrls: { quality: string; url: string }[]
  title:        string
}

interface AnimePlayerProps {
  episodeId: string | null
  className?: string
}

export default function AnimePlayer({ episodeId, className = '' }: AnimePlayerProps) {
  const [stream,   setStream]   = useState<StreamData | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [iframeOk, setIframeOk] = useState(false)
  const iframeRef               = useRef<HTMLIFrameElement>(null)
  const prevEpisodeId           = useRef<string | null>(null)

  useEffect(() => {
    if (!episodeId || episodeId === prevEpisodeId.current) return
    prevEpisodeId.current = episodeId

    setStream(null)
    setError(null)
    setIframeOk(false)
    setLoading(true)

    fetch(`/api/proxy/megaplay?episodeId=${encodeURIComponent(episodeId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json?.success || !json.data?.streamUrl) {
          setError('Stream tidak tersedia untuk episode ini.')
          return
        }
        setStream(json.data)
      })
      .catch(() => setError('Gagal memuat stream. Coba refresh.'))
      .finally(() => setLoading(false))
  }, [episodeId])

  // ── No episode selected ───────────────────────────────────────────────────
  if (!episodeId) {
    return (
      <div className={`flex flex-col items-center justify-center aspect-video rounded-2xl bg-zinc-900/60 border border-zinc-800 gap-3 ${className}`}>
        <div className="w-14 h-14 rounded-full bg-zinc-800/80 flex items-center justify-center">
          <Play className="w-6 h-6 text-zinc-500 translate-x-0.5" />
        </div>
        <p className="text-sm text-zinc-500">Pilih episode untuk mulai menonton</p>
      </div>
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`flex flex-col items-center justify-center aspect-video rounded-2xl bg-zinc-900/60 border border-zinc-800 gap-3 ${className}`}>
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
        <p className="text-sm text-zinc-500">Memuat stream…</p>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center aspect-video rounded-2xl bg-zinc-900/60 border border-zinc-800 gap-4 ${className}`}>
        <div className="w-14 h-14 rounded-full bg-zinc-800/80 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-zinc-300">{error}</p>
        </div>
        <button
          onClick={() => { prevEpisodeId.current = null; setError(null); setLoading(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Coba lagi
        </button>
      </div>
    )
  }

  if (!stream?.streamUrl) return null

  // ── Player ────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col gap-3 ${className}`}>

      {/* iframe wrapper */}
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800">
        {/* iframe loading skeleton */}
        {!iframeOk && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-zinc-950">
            <Loader2 className="w-7 h-7 text-accent animate-spin" />
            <p className="text-xs text-zinc-500">Menghubungkan ke player…</p>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={stream.streamUrl}
          title={stream.title || "Video Player"}
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture"
          onLoad={() => setIframeOk(true)}
          className={`absolute inset-0 w-full h-full border-0 transition-opacity duration-300 ${iframeOk ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>

      {/* Episode title + external link */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-zinc-500 truncate">{stream.title}</p>
        <a
          href={stream.streamUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Buka di tab baru
        </a>
      </div>

      {/* Download links (optional, shown if available) */}
      {stream.downloadUrls.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          <span className="text-xs text-zinc-600 self-center">Download:</span>
          {stream.downloadUrls.map((d) => (
            <a
              key={d.quality}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 text-xs text-zinc-300 transition-colors"
            >
              {d.quality}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}