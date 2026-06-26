export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  joinedAt: string;
  watchTime: number; // in minutes
  episodesCount: number;
  /** Role user — di-whitelist ketat di authStore, tidak pernah trust raw Firestore value */
  role?: "user" | "admin";
}

export type WatchlistStatus = "Watching" | "Plan to Watch" | "Completed";

export interface WatchlistItem {
  animeId: string;
  status: WatchlistStatus;
  addedAt: string;
}

export interface HistoryItem {
  animeId: string;
  episodeId: string;
  progress: number; // percentage (0-100)
  watchedAt: string;
  lastPlayedTime: number; // in seconds
}
