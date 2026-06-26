"use client";

import { useCallback } from "react";
import { usePlayerStore } from "@/store/playerStore";

/** Hook wrapping playerStore with convenient helpers */
export function usePlayer() {
  const store = usePlayerStore();

  const toggleMute = useCallback(() => {
    store.setMuted(!store.isMuted);
  }, [store]);

  const increaseVolume = useCallback(() => {
    store.setVolume(Math.min(1, store.volume + 0.1));
  }, [store]);

  const decreaseVolume = useCallback(() => {
    store.setVolume(Math.max(0, store.volume - 0.1));
  }, [store]);

  const cycleSpeed = useCallback(() => {
    const speeds = [0.75, 1.0, 1.25, 1.5, 2.0];
    const idx = speeds.indexOf(store.playbackSpeed);
    const next = speeds[(idx + 1) % speeds.length];
    store.setPlaybackSpeed(next);
  }, [store]);

  return { ...store, toggleMute, increaseVolume, decreaseVolume, cycleSpeed };
}
