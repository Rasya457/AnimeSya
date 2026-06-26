"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Heart, Search, Film, Calendar, Star, AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useAnime } from "@/hooks/useAnime";
import { WatchlistStatus } from "@/types/auth";
import AnimeCard from "@/components/anime/AnimeCard";
import { Button } from "@/components/ui/Button";

export default function WatchlistPage() {
  const { watchlist } = useAuthStore();
  const { getById } = useAnime();
  const [activeTab, setActiveTab] = useState<"All" | WatchlistStatus>("All");
  const [mounted, setMounted] = useState(false);
  const [fetchedAnime, setFetchedAnime] = useState<Record<string, any>>({});
  const [loadingItems, setLoadingItems] = useState(false);

  // Set mounted flag to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch details for watchlist items that are not in the homepage local cache
  useEffect(() => {
    if (!mounted || watchlist.length === 0) return;

    const missingIds = watchlist
      .map((item) => item.animeId)
      .filter((id) => !getById(id) && !fetchedAnime[id]);

    if (missingIds.length === 0) return;

    let active = true;
    setLoadingItems(true);

    async function fetchMissing() {
      try {
        const fetchPromises = missingIds.map(async (id) => {
          try {
            const res = await fetch(`/api/proxy/anime/${id}`);
            if (!res.ok) return null;
            const json = await res.json();
            if (json.statusCode === 200 && json.data) {
              return { id, data: json.data };
            }
          } catch (e) {
            console.error(`Failed to fetch watchlist item ${id}:`, e);
          }
          return null;
        });

        const results = await Promise.all(fetchPromises);
        if (!active) return;

        const newFetched: Record<string, any> = {};
        for (const res of results) {
          if (res) {
            newFetched[res.id] = res.data;
          }
        }

        if (Object.keys(newFetched).length > 0) {
          setFetchedAnime((prev) => ({ ...prev, ...newFetched }));
        }
      } catch (err) {
        console.error("Error fetching missing watchlist items:", err);
      } finally {
        if (active) setLoadingItems(false);
      }
    }

    fetchMissing();

    return () => {
      active = false;
    };
  }, [watchlist, getById, fetchedAnime, mounted]);

  // Map watchlist IDs to anime info
  const items = useMemo(() => {
    if (!mounted) return [];
    return watchlist
      .map((item) => {
        const cached = getById(item.animeId);
        if (cached) return { anime: cached, status: item.status, addedAt: item.addedAt };

        const fetched = fetchedAnime[item.animeId];
        if (fetched) {
          // Map to standard AnimeListItem format expected by AnimeCard
          const normalized = {
            animeId: fetched.slug,
            title: fetched.title,
            poster: fetched.poster,
            episodes: fetched.totalEpisodes,
            score: fetched.score,
            status: fetched.status,
            genres: fetched.genres?.map((g: any) => g.name) ?? [],
          };
          return { anime: normalized, status: item.status, addedAt: item.addedAt };
        }
        return null;
      })
      .filter(Boolean) as { anime: any; status: WatchlistStatus; addedAt: string }[];
  }, [watchlist, getById, fetchedAnime, mounted]);

  // Filter items matching active tab
  const filteredItems = useMemo(() => {
    if (activeTab === "All") return items;
    return items.filter((item) => item.status === activeTab);
  }, [items, activeTab]);

  if (!mounted) {
    return (
      <div className="w-full px-6 md:px-12 py-8 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-48 bg-zinc-900/60 rounded animate-pulse" />
          <div className="h-4 w-64 bg-zinc-900/60 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-6 md:px-12 py-8 flex flex-col gap-8">
      {/* Title */}
      <div className="flex flex-col gap-2">
        <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex items-center gap-2.5">
          <Heart className="w-5.5 h-5.5 text-red-500 fill-red-500" />
          My Collections
        </h2>
        <p className="text-xs text-zinc-500">Track and manage anime you want to watch or finished</p>
      </div>

      {/* Tabs list navigation */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-zinc-900 pb-3">
        {(["All", "Watching", "Plan to Watch", "Completed"] as const).map((tab) => {
          const count = tab === "All" ? items.length : items.filter((i) => i.status === tab).length;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-bold rounded-lg border transition-colors shrink-0 cursor-pointer flex items-center gap-2 ${
                isActive
                  ? "bg-accent/20 border-accent text-accent"
                  : "bg-zinc-950/40 border-zinc-900 text-zinc-400 hover:border-zinc-800"
              }`}
            >
              {tab}
              <span
                className={`px-1.5 py-0.5 text-[9px] font-black rounded-md ${
                  isActive ? "bg-accent text-zinc-950" : "bg-zinc-900 text-zinc-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Loading indicator if loading missing details */}
      {loadingItems && items.length === 0 && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      )}

      {/* Grid Content / Empty States */}
      {(!loadingItems || items.length > 0) && (
        filteredItems.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {filteredItems.map(({ anime }, i) => (
              <div key={anime.animeId ?? anime.slug ?? i}>
                <AnimeCard anime={anime} showEpisodeBadge={true} />
              </div>
            ))}
          </div>
        ) : (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center text-zinc-500">
              <Heart className="w-6 h-6" />
            </div>
            <div className="flex flex-col gap-1">
              <h4 className="text-base font-bold text-zinc-300">Your Watchlist is Empty</h4>
              <p className="text-xs text-zinc-500 max-w-xs leading-5">
                Explore our catalogue and add your favorite titles to keep track of new releases.
              </p>
            </div>
            <Link href="/browse">
              <Button size="sm">Explore Catalog</Button>
            </Link>
          </div>
        )
      )}
    </div>
  );
}

