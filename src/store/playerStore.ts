import { create } from 'zustand'

interface PlayerStore {
  currentTime: number
  duration: number
  isPlaying: boolean
  isMuted: boolean
  volume: number
  selectedQuality: string
  selectedProvider: string
  autoplay: boolean
  setAutoplay: (v: boolean) => void
  playbackSpeed: number
  setPlaybackSpeed: (speed: number) => void
  setCurrentTime: (t: number) => void
  setDuration: (d: number) => void
  setPlaying: (v: boolean) => void
  setMuted: (v: boolean) => void
  setVolume: (v: number) => void
  setQuality: (q: string) => void
  setProvider: (p: string) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerStore>((set) => ({
  currentTime:      0,
  duration:         0,
  isPlaying:        false,
  isMuted:          false,
  volume:           1,
  selectedQuality:  '720p',
  selectedProvider: '',
  autoplay:         true,
  setAutoplay:      (v) => set({ autoplay: v }),
  playbackSpeed:    1.0,
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setCurrentTime:   (t) => set({ currentTime: t }),
  setDuration:      (d) => set({ duration: d }),
  setPlaying:       (v) => set({ isPlaying: v }),
  setMuted:         (v) => set({ isMuted: v }),
  setVolume:        (v) => set({ volume: v }),
  setQuality:       (q) => set({ selectedQuality: q }),
  setProvider:      (p) => set({ selectedProvider: p }),
  reset:            ()  => set({ currentTime: 0, duration: 0, isPlaying: false }),
}))