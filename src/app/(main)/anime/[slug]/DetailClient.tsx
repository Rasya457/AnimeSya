"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Star, Play, Bookmark, Clock, Calendar, Check, AlertCircle, Sparkles, Tv, Layers } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { WatchlistStatus } from "@/types/auth";
import { AnimeDetail } from "@/types/anime";

interface DetailClientProps {
  anime: AnimeDetail;
}

export default function DetailClient({ anime }: DetailClientProps) {
  const { watchlist, history: watchHistory, addToWatchlist, removeFromWatchlist } = useAuthStore();
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  // Baca dari authStore (Firestore) — bukan localStorage, sehingga akun baru selalu mulai dari 0
  const animeHistory = watchHistory.filter(
    (h) => String((h as any).malId ?? (h as any).animeId) === String(anime.slug)
  );
  const lastWatchedEpisode: number | null = animeHistory.length > 0
    ? Math.max(...animeHistory.map((h) => Number((h as any).episode ?? (h as any).episodeId ?? 0)).filter(Boolean))
    : null;
  const watchedEpisodes: number[] = animeHistory.flatMap((h) =>
    Array.isArray((h as any).watchedEpisodes)
      ? (h as any).watchedEpisodes
      : [(h as any).episode ?? (h as any).episodeId].filter(Boolean).map(Number)
  );

  const watchlistItem = watchlist.find((item) => item.animeId === anime.slug);
  const isAdded = !!watchlistItem;

  const handleStatusChange = (status: WatchlistStatus) => {
    addToWatchlist(anime.slug, status);
    setShowStatusDropdown(false);
  };

  const ratingValue = anime.score || 0;
  const genresList = anime.genres || [];

  // Helper: build watch URL → /watch/{malId}/{episodeNumber}
  const watchUrl = (epNum: number) => `/watch/${anime.slug}/${epNum}`;

  // ── Supplement episode list ──────────────────────────────────────────────
  // Jikan /anime/{id}/episodes sering telat index episode terbaru.
  // Karena stream pakai Megaplay (cukup malId + epNum), kita generate
  // slot placeholder untuk episode yang belum masuk list Jikan.
  //
  // Prioritas sumber "berapa episode yang seharusnya ada":
  //   1. currentEpisode — kalau detail route sudah hitung (sama kayak home proxy)
  //   2. Jumlah episode dari list Jikan — fallback
  const listedEps   = anime.episodes ?? [];
  const maxListed   = listedEps.reduce((m, e) => Math.max(m, e.episodeNumber ?? 0), 0);
  const currentEp   = typeof (anime as any).currentEpisode === "number"
    ? (anime as any).currentEpisode as number
    : null;
  // Pakai totalEpisodes (dari Jikan) sebagai batas atas jika diketahui,
  // untuk mencegah estimasi currentEpisode melebihi jumlah episode sebenarnya.
  const knownTotal  = typeof anime.totalEpisodes === "number" && anime.totalEpisodes > 0
    ? anime.totalEpisodes
    : null;
  const rawMax      = currentEp ?? maxListed;
  const expectedMax = knownTotal ? Math.min(rawMax, knownTotal) : rawMax;

  const displayEpisodes = expectedMax > maxListed
    ? [
        ...listedEps,
        ...Array.from({ length: expectedMax - maxListed }, (_, i) => ({
          slug:          `gen-ep-${maxListed + i + 1}`,
          episodeNumber: maxListed + i + 1,
          title:         `Episode ${maxListed + i + 1}`,
          uploadDate:    null as string | null,
        })),
      ]
    : listedEps;

  return (
    <div className="w-full pb-16 flex flex-col select-none relative bg-zinc-950 min-h-screen">

      {/* 1. Header Banner */}
      <div className="relative w-full aspect-[21/9] md:h-[45vh] min-h-[260px] flex items-end">
        <div className="absolute inset-0">
          <Image
            src={anime.poster}
            alt={anime.title}
            fill
            priority
            sizes="100vw"
            className="w-full h-full object-cover object-center filter brightness-[0.3] blur-[4px] scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-transparent" />
        </div>
      </div>

      {/* 2. Main Info */}
      <div className="max-w-7xl mx-auto w-full px-6 md:px-12 flex flex-col md:flex-row gap-8 md:gap-12 -mt-24 md:-mt-32 relative z-10">

        {/* Cover */}
        <div className="w-48 sm:w-56 md:w-64 shrink-0 rounded-2xl overflow-hidden shadow-2xl border border-zinc-800 bg-zinc-900 aspect-[3/4] relative">
          <Image
            src={anime.poster}
            alt={anime.title}
            fill
            sizes="(max-width: 768px) 192px, (max-width: 1024px) 224px, 256px"
            priority
            className="w-full h-full object-cover"
          />
        </div>

        {/* Details */}
        <div className="flex-1 flex flex-col gap-5 pt-0 md:pt-10">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl sm:text-2xl md:text-4xl font-black text-zinc-100 tracking-tight">
              {anime.title}
            </h1>
            {anime.alternativeTitle && (
              <p className="text-xs md:text-sm text-zinc-500 font-semibold">{anime.alternativeTitle}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-zinc-400">
            <span className="flex items-center gap-1 text-accent font-bold">
              <Star className="w-4 h-4 fill-accent" />
              {ratingValue.toFixed(1)} Score
            </span>
            <span className="w-1 h-1 rounded-full bg-zinc-800" />
            <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{anime.aired || "N/A"}</span>
            <span className="w-1 h-1 rounded-full bg-zinc-800" />
            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{anime.status}</span>
            <span className="w-1 h-1 rounded-full bg-zinc-800" />
            <span className="flex items-center gap-1.5"><Tv className="w-3.5 h-3.5" />{anime.type}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {genresList.map((g) => (
              <Badge key={g.slug} variant="accent">{g.name}</Badge>
            ))}
          </div>

          <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-2xl">{anime.synopsis}</p>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-zinc-500">
            {anime.studio && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                Studio: <strong className="text-zinc-300 ml-0.5">{anime.studio}</strong>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-accent" />
              Episodes: <strong className="text-zinc-300 ml-0.5">{anime.totalEpisodes}</strong>
            </span>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-4 mt-2 relative">
            {lastWatchedEpisode !== null ? (
              <>
                <Link href={watchUrl(lastWatchedEpisode)}>
                  <Button size="lg" icon={<Play className="w-4.5 h-4.5 fill-zinc-950" />}>
                    Lanjut Nonton (Ep. {lastWatchedEpisode})
                  </Button>
                </Link>
                {displayEpisodes.length > 0 && displayEpisodes[0].episodeNumber !== lastWatchedEpisode && (
                  <Link href={watchUrl(displayEpisodes[0].episodeNumber ?? 1)}>
                    <Button variant="outline" size="lg" icon={<Play className="w-4.5 h-4.5" />}>
                      Mulai Nonton (Ep. 1)
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              displayEpisodes.length > 0 && (
                <Link href={watchUrl(displayEpisodes[0].episodeNumber ?? 1)}>
                  <Button size="lg" icon={<Play className="w-4.5 h-4.5 fill-zinc-950" />}>
                    Mulai Nonton
                  </Button>
                </Link>
              )
            )}

            <div className="relative">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className={isAdded ? "border-accent/40 text-accent font-semibold bg-accent/5" : ""}
                icon={isAdded ? <Check className="w-4.5 h-4.5 text-accent" /> : <Bookmark className="w-4.5 h-4.5" />}
              >
                {isAdded ? watchlistItem.status : "Add to Collections"}
              </Button>

              {showStatusDropdown && (
                <div className="absolute left-0 mt-2 w-48 rounded-xl glass-dark border border-zinc-800 shadow-2xl p-1.5 flex flex-col gap-0.5 z-20">
                  {(["Watching", "Plan to Watch", "Completed"] as WatchlistStatus[]).map((status) => (
                    <button
                      key={status}
                      onClick={() => handleStatusChange(status)}
                      className={`w-full px-3 py-2 text-xs font-bold text-left rounded-lg transition-colors cursor-pointer hover:bg-zinc-900/60 ${
                        watchlistItem?.status === status ? "text-accent bg-accent/5" : "text-zinc-400"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                  {isAdded && (
                    <button
                      onClick={() => { removeFromWatchlist(anime.slug); setShowStatusDropdown(false); }}
                      className="w-full px-3 py-2 text-xs font-bold text-left text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                      Remove Item
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Related Seasons / Connections — horizontal scroll */}
      {anime.relations && anime.relations.length > 0 && (
        <section className="max-w-7xl mx-auto w-full mt-12 flex flex-col gap-4">
          <div className="flex items-center justify-between px-6 md:px-12">
            <h3 className="text-lg md:text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
              Seasons & Hubungan Anime
              <span className="text-xs font-semibold text-zinc-500 bg-zinc-900 px-2 py-0.5 border border-zinc-800 rounded-md">
                {anime.relations.length} Hubungan
              </span>
            </h3>
          </div>

          {/* Horizontal scroll container */}
          <div
            className="flex flex-nowrap gap-3 px-6 md:px-12 cursor-grab active:cursor-grabbing"
            style={{
              overflowX: 'auto',
              overflowY: 'hidden',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              scrollSnapType: 'x mandatory',
              touchAction: 'pan-x',
              paddingBottom: '8px',
            }}
          >
            {anime.relations.map((rel) => {
              let badgeColor = "bg-zinc-800 text-zinc-400 border-zinc-700";
              const relLower = rel.relation.toLowerCase();
              if (/^season \d+$/.test(relLower)) {
                badgeColor = "bg-accent/10 text-accent border-accent/20";
              } else if (relLower.includes("sequel")) {
                badgeColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
              } else if (relLower.includes("prequel")) {
                badgeColor = "bg-sky-500/10 text-sky-400 border-sky-500/20";
              } else if (relLower.includes("spin-off") || relLower.includes("spin off")) {
                badgeColor = "bg-purple-500/10 text-purple-400 border-purple-500/20";
              } else if (relLower.includes("side story")) {
                badgeColor = "bg-pink-500/10 text-pink-400 border-pink-500/20";
              } else if (relLower.includes("alternative")) {
                badgeColor = "bg-amber-500/10 text-amber-400 border-amber-500/20";
              }

              return (
                <Link
                  key={rel.malId}
                  href={`/anime/${rel.malId}`}
                  draggable={false}
                  className="group relative shrink-0 flex flex-col gap-2 rounded-2xl overflow-hidden bg-zinc-900/30 hover:bg-zinc-900/70 border border-zinc-800/40 hover:border-accent/30 transition-all duration-300"
                  style={{ width: '160px', scrollSnapAlign: 'start' }}
                >
                  {/* Poster thumbnail */}
                  <div className="relative w-full bg-zinc-900" style={{ aspectRatio: '2/3' }}>
                    {rel.poster ? (
                      <Image
                        src={rel.poster}
                        alt={rel.title}
                        fill
                        sizes="160px"
                        className="object-cover object-center transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center">
                        <Tv className="w-8 h-8 text-zinc-600" />
                      </div>
                    )}
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent" />
                    {/* Relation badge */}
                    <span className={`absolute top-2 left-2 text-[8px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${badgeColor}`}>
                      {rel.relation}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="px-2.5 pb-3 flex flex-col gap-1">
                    <h4 className="text-[11px] font-bold text-zinc-200 group-hover:text-accent transition-colors leading-snug line-clamp-2">
                      {rel.title}
                    </h4>
                    <div className="flex items-center gap-2 text-[9px] font-semibold text-zinc-500">
                      {rel.score && (
                        <span className="flex items-center gap-0.5 text-accent">
                          <Star className="w-2.5 h-2.5 fill-accent" />
                          {Number(rel.score).toFixed(1)}
                        </span>
                      )}
                      {rel.type && <span>{rel.type}</span>}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 3. Episodes Grid */}
      <section className="max-w-7xl mx-auto w-full px-6 md:px-12 mt-12 flex flex-col gap-6">
        <h3 className="text-lg md:text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
          Episodes List
          <span className="text-xs font-semibold text-zinc-500 bg-zinc-900 px-2 py-0.5 border border-zinc-800 rounded-md">
            {displayEpisodes.length} Episodes
          </span>
        </h3>

        {displayEpisodes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {displayEpisodes.map((ep) => {
              const isWatched = watchedEpisodes.includes(ep.episodeNumber);
              return (
                <Link
                  key={ep.slug}
                  href={watchUrl(ep.episodeNumber)}
                  className={`group flex items-center justify-between gap-4 rounded-xl overflow-hidden bg-zinc-900/30 border p-4 transition-all duration-200 hover:border-accent/40 hover:bg-zinc-900/60 ${
                    isWatched ? 'border-emerald-500/20 bg-emerald-500/[0.02]' : 'border-zinc-900'
                  }`}
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-extrabold uppercase tracking-wider ${
                        isWatched ? 'text-emerald-400' : 'text-accent'
                      }`}>
                        Episode {ep.episodeNumber}
                      </span>
                      {isWatched && (
                        <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" /> Sudah Ditonton
                        </span>
                      )}
                    </div>
                    <h4 className="text-xs font-bold text-zinc-200 truncate group-hover:text-white transition-colors">
                      {ep.title}
                    </h4>
                    {ep.uploadDate && (
                      <span className="text-[9px] text-zinc-500">{ep.uploadDate}</span>
                    )}
                  </div>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                    isWatched
                      ? 'bg-emerald-950/60 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-zinc-950'
                      : 'bg-zinc-800 text-zinc-300 group-hover:bg-accent group-hover:text-zinc-950'
                  }`}>
                    {isWatched ? (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current translate-x-[1px]" />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 border border-dashed border-zinc-800 rounded-2xl text-zinc-500 gap-3">
            <AlertCircle className="w-7 h-7" />
            <span className="text-sm font-semibold">No episodes released yet</span>
          </div>
        )}
      </section>
    </div>
  );
}