'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'

interface UseProgressOptions {
  animeId: string
  episodeId: string
  getCurrentTime: () => number
  getDuration: () => number
  onRestored?: (time: number) => void
}

export function useProgress({
  animeId,
  episodeId,
  getCurrentTime,
  getDuration,
  onRestored,
}: UseProgressOptions) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const restoredRef = useRef(false)

  // Restore progress on mount
  useEffect(() => {
    if (!isAuthenticated || restoredRef.current) return

    async function restore() {
      try {
        const res = await fetch(`/api/proxy/progress/${animeId}/${episodeId}`)
        if (!res.ok) return
        const data = await res.json()
        if (data?.timestamp_seconds && data.timestamp_seconds > 5) {
          onRestored?.(data.timestamp_seconds)
          restoredRef.current = true
        }
      } catch {
        // silent fail
      }
    }

    restore()
  }, [isAuthenticated, animeId, episodeId, onRestored])

  // Save progress every 10 seconds
  useEffect(() => {
    if (!isAuthenticated) return

    intervalRef.current = setInterval(async () => {
      const current  = getCurrentTime()
      const duration = getDuration()
      if (current < 5 || duration < 1) return

      try {
        await fetch('/api/proxy/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            anime_id:          animeId,
            episode_id:        episodeId,
            timestamp_seconds: Math.floor(current),
            duration_seconds:  Math.floor(duration),
            completed:         current / duration > 0.9,
          }),
        })
      } catch {
        // silent fail
      }
    }, 10_000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isAuthenticated, animeId, episodeId, getCurrentTime, getDuration])
}