"use client";

import { useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import { WatchlistStatus } from "@/types/auth";
import { useAnime } from "./useAnime";

/** Hook exposing convenient watchlist actions and derived state */
export function useWatchlist() {
  const { watchlist, addToWatchlist, removeFromWatchlist } = useAuthStore();
  const { getById } = useAnime();

  /** Check whether an anime is already in the user's watchlist */
  const isInWatchlist = useCallback(
    (animeId: string) => watchlist.some((item) => item.animeId === animeId),
    [watchlist]
  );

  /** Get the status of an anime in the watchlist */
  const getStatus = useCallback(
    (animeId: string): WatchlistStatus | null =>
      watchlist.find((item) => item.animeId === animeId)?.status ?? null,
    [watchlist]
  );

  /** Toggle between adding (Watching) and removing */
  const toggle = useCallback(
    (animeId: string) => {
      if (isInWatchlist(animeId)) {
        removeFromWatchlist(animeId);
      } else {
        addToWatchlist(animeId, "Plan to Watch");
      }
    },
    [isInWatchlist, addToWatchlist, removeFromWatchlist]
  );

  /** Enriched watchlist with full anime objects */
  const enrichedList = watchlist
    .map((item) => {
      const anime = getById(item.animeId);
      return anime ? { ...item, anime } : null;
    })
    .filter(Boolean);

  return { watchlist, enrichedList, isInWatchlist, getStatus, toggle, addToWatchlist, removeFromWatchlist };
}
