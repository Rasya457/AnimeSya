"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Sparkles, AlertCircle, Search, X } from "lucide-react";
import { useAnime } from "@/hooks/useAnime";
import { animeApi } from "@/lib/anime-api";
import AnimeCard from "@/components/anime/AnimeCard";
import { Button } from "@/components/ui/Button";
import type { AnimeListItem } from "@/types/anime";

export default function BrowsePage() {
  const { animeList, allGenres = [], loading } = useAnime();

  const [query,          setQuery]          = useState("");
  const [searchResults,  setSearchResults]  = useState<AnimeListItem[]>([]);
  const [searching,      setSearching]      = useState(false);
  const [selectedGenre,  setSelectedGenre]  = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [sortBy,         setSortBy]         = useState<"score" | "title">("score");

  // Debounced Jikan search
  useEffect(() => {
    if (!query.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await animeApi.search(query);
        setSearchResults(results);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [query]);

  // Sumber data: hasil search Jikan kalau ada query, sinon animeList lokal
  const sourceList = query.trim() ? searchResults : animeList;

  const filteredAnime = useMemo(() => {
    return sourceList
      .filter((anime: any) => {
        const genreMatch  = selectedGenre  === "All" || (anime.genres ?? []).includes(selectedGenre);
        const statusMatch = selectedStatus === "All" || anime.status === selectedStatus;
        return genreMatch && statusMatch;
      })
      .sort((a: any, b: any) => {
        if (sortBy === "score") return (b.score ?? 0) - (a.score ?? 0);
        if (sortBy === "title") return (a.title ?? "").localeCompare(b.title ?? "");
        return 0;
      });
  }, [sourceList, selectedGenre, selectedStatus, sortBy]);

  const handleReset = () => {
    setQuery("");
    setSelectedGenre("All");
    setSelectedStatus("All");
    setSortBy("score");
  };

  if (loading) return (
    <div className="w-full px-6 md:px-12 py-8 text-zinc-500 animate-pulse text-sm">
      Loading catalog...
    </div>
  );

  return (
    <div className="w-full px-6 md:px-12 py-8 flex flex-col gap-8 select-none">

      {/* Title */}
      <div className="flex flex-col gap-2">
        <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex items-center gap-2.5">
          <Sparkles className="w-5 h-5 text-accent animate-pulse" />
          Browse Catalog
        </h2>
        <p className="text-xs text-zinc-500">Explore complete anime seasons, movies, and specials</p>
      </div>

      {/* Filter Panel */}
      <div className="w-full bg-zinc-900/25 border border-zinc-900 rounded-2xl p-5 md:p-6 flex flex-col gap-6 backdrop-blur-sm">

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anime..."
            className="w-full h-10 pl-10 pr-10 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-accent/60 transition-colors"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Status / Sort */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Status</span>
            <div className="flex gap-2">
              {["All", "Ongoing", "Completed"].map((st) => (
                <button key={st} onClick={() => setSelectedStatus(st)}
                  className={`flex-1 h-9 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    selectedStatus === st
                      ? "bg-accent/25 border-accent text-accent"
                      : "bg-zinc-900/40 border-zinc-800/80 text-zinc-400 hover:border-zinc-700"
                  }`}
                >{st}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Sort By</span>
            <div className="flex gap-2">
              {(["score", "title"] as const).map((s) => (
                <button key={s} onClick={() => setSortBy(s)}
                  className={`flex-1 h-9 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    sortBy === s
                      ? "bg-accent/25 border-accent text-accent"
                      : "bg-zinc-900/40 border-zinc-800/80 text-zinc-400 hover:border-zinc-700"
                  }`}
                >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Genre Pills — hanya tampil saat tidak search */}
        {!query && allGenres.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Genres</span>
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1.5">
              {["All", ...allGenres].map((g) => (
                <button key={g} onClick={() => setSelectedGenre(g)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold border shrink-0 transition-colors cursor-pointer ${
                    selectedGenre === g
                      ? "bg-accent text-zinc-950 border-accent"
                      : "bg-zinc-900/40 border-zinc-800/80 text-zinc-400 hover:border-zinc-700"
                  }`}
                >{g === "All" ? "All Genres" : g}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results count */}
      <p className="text-xs text-zinc-500">
        {searching
          ? "Searching..."
          : <>Showing <span className="text-zinc-300 font-bold">{filteredAnime.length}</span> titles {query && `for "${query}"`}</>
        }
      </p>

      {/* Grid / Empty */}
      {filteredAnime.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {filteredAnime.map((anime, i) => (
            <div key={`${anime.animeId}-${i}`} className="flex justify-center">
              <AnimeCard anime={anime} showEpisodeBadge />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="w-16 h-16 rounded-full bg-zinc-900/50 border border-zinc-800 flex items-center justify-center text-zinc-500">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-base font-bold text-zinc-300">No Anime Found</h4>
            <p className="text-xs text-zinc-500 max-w-xs">
              {query ? `No results for "${query}". Try a different keyword.` : "No titles match your filters."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>Reset</Button>
        </div>
      )}
    </div>
  );
}