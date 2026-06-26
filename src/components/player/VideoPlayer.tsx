'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type Hls from 'hls.js'
import type { StreamSource } from '@/types/anime'

interface Props {
  source: StreamSource
  initialTime?: number
  onTimeUpdate?: (current: number, duration: number) => void
}

type PlayerState = 'loading' | 'ready' | 'error'

const LARAVEL_STREAM_PROXY = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}/api/stream/proxy?url=`

function buildProxiedUrl(url: string): string {
  if (url.includes("test-streams.mux.dev") || url.includes("mux.dev")) {
    return url;
  }
  return LARAVEL_STREAM_PROXY + encodeURIComponent(url)
}

export function VideoPlayer({ source, initialTime = 0, onTimeUpdate }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const hlsRef    = useRef<Hls | null>(null)
  const [state, setState] = useState<PlayerState>('loading')
  const [error, setError] = useState('')
  const hasRestored = useRef(false)

  const initHls = useCallback(async (src: string) => {
    const HlsModule = await import('hls.js')
    const HlsClass  = HlsModule.default

    if (!HlsClass.isSupported()) {
      setError('Browser tidak support HLS.')
      setState('error')
      return
    }

    if (hlsRef.current) {
      hlsRef.current.destroy()
    }

    const hls = new HlsClass({
      enableWorker: true,
      maxBufferLength: 60,
    })

    hls.loadSource(src)
    hls.attachMedia(videoRef.current!)

    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
      setState('ready')
      if (initialTime > 5 && !hasRestored.current) {
        videoRef.current!.currentTime = initialTime
        hasRestored.current = true
      }
      videoRef.current?.play().catch(() => {})
    })

    hls.on(HlsClass.Events.ERROR, (_, data) => {
      if (data.fatal) {
        setError('Gagal memuat stream. Coba provider lain.')
        setState('error')
      }
    })

    hlsRef.current = hls
  }, [initialTime])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !source) return

    setState('loading')
    setError('')
    hasRestored.current = false

    const isEmbed = source.isEmbed
    if (isEmbed) {
      setState('ready')
      return
    }

    const isM3u8 =
      source.url.includes('.m3u8') ||
      source.url.includes('m3u8')

    if (isM3u8) {
      const proxied = buildProxiedUrl(source.url)
      initHls(proxied)
    } else {
      // Direct MP4
      video.src = buildProxiedUrl(source.url)
      video.oncanplay = () => {
        setState('ready')
        if (initialTime > 5 && !hasRestored.current) {
          video.currentTime = initialTime
          hasRestored.current = true
        }
        video.play().catch(() => {})
      }
      video.onerror = () => {
        setError('Gagal memuat video. Coba provider lain.')
        setState('error')
      }
    }

    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [source, initHls, initialTime])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !onTimeUpdate) return

    const handler = () => onTimeUpdate(video.currentTime, video.duration ?? 0)
    video.addEventListener('timeupdate', handler)
    return () => video.removeEventListener('timeupdate', handler)
  }, [onTimeUpdate])

  // Embed source (iframe)
  if (source.isEmbed && state === 'ready') {
    return (
      <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
        <iframe
          src={source.url}
          className="absolute inset-0 w-full h-full"
          allowFullScreen
          allow="autoplay; fullscreen"
        />
      </div>
    )
  }

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      {/* Loading overlay */}
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">Memuat stream...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {state === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <span className="text-4xl">⚠️</span>
            <p className="text-white font-medium">Stream gagal dimuat</p>
            <p className="text-zinc-400 text-sm">{error}</p>
          </div>
        </div>
      )}

      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        playsInline
      />
    </div>
  )
}