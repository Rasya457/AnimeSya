"use client";

import React, { useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, Clock, Tv, Settings, Heart, Award } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useAnime } from "@/hooks/useAnime";
import { Button } from "@/components/ui/Button";
import AnimeCard from "@/components/anime/AnimeCard";

interface HistoryItem {
  malId: string;
  title: string;
  poster: string;
  episode: number;
  watchedAt: number;
}

// Ambil history dari localStorage
function getWatchHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem("watch-history") ?? "[]");
  } catch {
    return [];
  }
}

// ─── Level system ─────────────────────────────────────────────────────────────

const LEVELS = [
  { minEps: 0,    label: "Casual",       emoji: "🌱" },
  { minEps: 10,   label: "Beginner",     emoji: "📺" },
  { minEps: 50,   label: "Fan",          emoji: "⭐" },
  { minEps: 100,  label: "Watcher",      emoji: "🎯" },
  { minEps: 200,  label: "Otaku",        emoji: "🔥" },
  { minEps: 500,  label: "Elite Otaku",  emoji: "💎" },
  { minEps: 1000, label: "Legendary",    emoji: "👑" },
] as const;

function getLevelInfo(eps: number) {
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (eps >= LEVELS[i].minEps) idx = i;
  }
  const current  = LEVELS[idx];
  const next     = LEVELS[idx + 1] ?? null;
  const progress = next
    ? Math.min(100, ((eps - current.minEps) / (next.minEps - current.minEps)) * 100)
    : 100;
  return { level: idx + 1, label: current.label, emoji: current.emoji, next, progress };
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, watchlist, isAuthenticated } = useAuthStore();
  const { getById } = useAnime();

  const [episodesWatched, setEpisodesWatched] = useState(0);
  const [hoursWatched,    setHoursWatched]    = useState("0.0");

  // Redirect if guest
  useEffect(() => {
    if (!isAuthenticated || !user) router.push("/login");
  }, [isAuthenticated, user, router]);

  // Hitung stats dari localStorage history
  useEffect(() => {
    const history = getWatchHistory();
    setEpisodesWatched(history.length);
    // Estimasi: 1 episode = 24 menit
    const totalMins = history.length * 24;
    setHoursWatched((totalMins / 60).toFixed(1));
  }, []);

  const levelInfo = useMemo(() => getLevelInfo(episodesWatched), [episodesWatched]);

  const favorites = useMemo(() => {
    return watchlist
      .slice(0, 3)
      .map((item) => getById(item.animeId))
      .filter(Boolean) as any[];
  }, [watchlist, getById]);

  if (!user) return null;

  return (
    <div className="w-full px-6 md:px-12 py-8 flex flex-col gap-8 select-none">

      {/* 1. Header Card */}
      <div className="relative w-full rounded-2xl overflow-hidden glass-dark border border-zinc-800 p-6 md:p-8 flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-accent/5 blur-[80px] pointer-events-none" />

        <div className="flex flex-col md:flex-row items-center gap-6 z-10 text-center md:text-left">
          {/* Avatar — foto atau inisial */}
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-24 h-24 rounded-full object-cover border-2 border-accent shadow-lg shrink-0"
            />
          ) : (
            <div className="w-24 h-24 rounded-full border-2 border-accent bg-zinc-800 flex items-center justify-center text-3xl font-black text-accent shrink-0">
              {user.name?.[0]?.toUpperCase() ?? "U"}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex items-center justify-center md:justify-start gap-2.5">
              {user.name}
              <Badge variant="accent">
                {levelInfo.emoji} Lv.{levelInfo.level} · {levelInfo.label}
              </Badge>
            </h2>
            <p className="text-xs text-zinc-500">{user.email}</p>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 mt-1 justify-center md:justify-start">
              <Calendar className="w-3.5 h-3.5" />
              <span>Joined {user.joinedAt}</span>
            </div>

            {/* Level progress bar */}
            <div className="flex flex-col gap-1 mt-1 w-full max-w-xs">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>{episodesWatched} eps watched</span>
                {levelInfo.next
                  ? <span>{levelInfo.next.minEps - episodesWatched} to Lv.{levelInfo.level + 1}</span>
                  : <span className="text-accent">Max Level!</span>
                }
              </div>
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-700"
                  style={{ width: `${levelInfo.progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <Link href="/profile/settings" className="z-10">
          <Button variant="outline" size="sm" icon={<Settings className="w-4 h-4" />}>
            Edit Profile
          </Button>
        </Link>
      </div>

      {/* 2. Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard icon={<Clock className="w-5 h-5" />} label="Time Watched" value={`${hoursWatched}h`} />
        <StatCard icon={<Tv className="w-5 h-5" />}   label="Episodes Finished" value={`${episodesWatched} eps`} />
        <StatCard icon={<Heart className="w-5 h-5" />} label="Total Watchlist"  value={`${watchlist.length} titles`} />
      </div>

      {/* 3. Favorites */}
      <section className="flex flex-col gap-6">
        <h3 className="text-base md:text-lg font-bold tracking-tight text-zinc-100 flex items-center gap-2">
          <Award className="w-5 h-5 text-accent" />
          Featured Favorites
        </h3>

        {favorites.length > 0 ? (
          <div className="flex flex-wrap gap-6">
            {favorites.map((anime, index) => (
              <AnimeCard key={anime.id ?? anime.malId ?? index} anime={anime} showEpisodeBadge />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 border border-dashed border-zinc-800 rounded-2xl text-zinc-500 gap-3 text-center">
            <Heart className="w-7 h-7" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-zinc-400">No favorite shows listed</span>
              <span className="text-[10px] text-zinc-500">Add series to your watchlist to see them here</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 p-5 rounded-2xl bg-zinc-900/10 border border-zinc-900">
      <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
        {icon}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold text-zinc-500 uppercase">{label}</span>
        <span className="text-lg font-black text-zinc-100">{value}</span>
      </div>
    </div>
  );
}

function Badge({ children, variant = "secondary", className = "" }: {
  children: React.ReactNode;
  variant?: "accent" | "secondary";
  className?: string;
}) {
  return (
    <span className={`px-2 py-0.5 rounded text-[9px] font-black tracking-wide uppercase shrink-0 border ${
      variant === "accent"
        ? "bg-accent/20 border-accent/30 text-accent"
        : "bg-zinc-900 border-zinc-800 text-zinc-400"
    } ${className}`}>
      {children}
    </span>
  );
}