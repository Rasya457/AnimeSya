"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { History, Trash2, Play, Clock, LayoutGrid, List, Search, X } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { getHistoryKey } from "@/lib/historyKey";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HistoryItem {
  malId: string;
  title: string;
  poster: string;
  episode: number;
  watchedAt: number;
}

type ViewMode = "grid" | "list";

interface DateGroup {
  label: string;
  items: HistoryItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HISTORY_KEY_BASE = "watch-history"; // tidak dipakai langsung

function getHistory(key: string): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(key: string, items: HistoryItem[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

function timeAgo(ts: number) {
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)  return "Baru saja";
  if (mins  < 60) return `${mins} mnt lalu`;
  if (hours < 24) return `${hours} jam lalu`;
  return `${days} hari lalu`;
}

function groupByDate(items: HistoryItem[]): DateGroup[] {
  const now       = new Date();
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const weekAgo   = today - 6 * 86_400_000;

  const buckets: Record<string, HistoryItem[]> = {
    "Hari ini":   [],
    "Kemarin":    [],
    "Minggu ini": [],
    "Lebih lama": [],
  };

  for (const item of items) {
    if      (item.watchedAt >= today)     buckets["Hari ini"].push(item);
    else if (item.watchedAt >= yesterday) buckets["Kemarin"].push(item);
    else if (item.watchedAt >= weekAgo)   buckets["Minggu ini"].push(item);
    else                                  buckets["Lebih lama"].push(item);
  }

  return Object.entries(buckets)
    .filter(([, arr]) => arr.length > 0)
    .map(([label, items]) => ({ label, items }));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { user } = useAuthStore();
  const [items,   setItems]   = useState<HistoryItem[]>([]);
  const [view,    setView]    = useState<ViewMode>("grid");
  const [query,   setQuery]   = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const key = getHistoryKey(user?.id)
    const raw = getHistory(key);
    const uniqueMap = new Map<string, HistoryItem>();
    for (const item of raw) {
      if (!uniqueMap.has(item.malId)) {
        uniqueMap.set(item.malId, item);
      }
    }
    const unique = Array.from(uniqueMap.values());
    setItems(unique.reverse());
    setMounted(true);
  }, [user?.id]);

  function handleRemove(malId: string, episode: number) {
    const key = getHistoryKey(user?.id)
    const next = getHistory(key).filter(
      (h) => !(h.malId === malId && h.episode === episode)
    );
    saveHistory(key, next);
    setItems(next.reverse());
  }

  function handleClear() {
    const key = getHistoryKey(user?.id)
    saveHistory(key, []);
    setItems([]);
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, query]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <>
      {/* Global keyframe — no styled-jsx needed */}
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .anim-card {
          animation: fadeSlideUp 0.38s ease both;
        }
        /* hide scrollbar globally for this page if needed */
      `}</style>

      <div className="min-h-screen bg-zinc-950 text-white flex flex-col">

        {/* ── Header ── */}
        <div className="border-b border-zinc-900 px-6 md:px-12 pt-10 pb-8 flex flex-col gap-5">

          {/* Title row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center">
                  <History className="w-4 h-4 text-accent" />
                </div>
                <h1 className="text-2xl md:text-3xl font-black text-zinc-100 tracking-tight">
                  Riwayat
                </h1>
                {items.length > 0 && (
                  <span className="text-xs font-bold text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-full px-2.5 py-0.5">
                    {items.length}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-600 pl-[42px]">
                Anime yang pernah kamu tonton
              </p>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Grid / List toggle */}
              <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 gap-1">
                <button
                  onClick={() => setView("grid")}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                    view === "grid"
                      ? "bg-zinc-700 text-white shadow"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setView("list")}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                    view === "list"
                      ? "bg-zinc-700 text-white shadow"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Clear all */}
              {items.length > 0 && (
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                             text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20
                             border border-red-500/15 hover:border-red-500/30 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Hapus Semua</span>
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          {items.length > 0 && (
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari judul anime..."
                className="w-full bg-zinc-900/80 border border-zinc-800 focus:border-zinc-600 rounded-xl
                           pl-9 pr-9 py-2.5 text-sm text-zinc-200 placeholder-zinc-600
                           outline-none transition-colors"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 px-6 md:px-12 py-8">

          {/* Empty state */}
          {mounted && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 gap-5 text-center">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Clock className="w-8 h-8 text-zinc-700" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center">
                  <span className="text-[10px] text-zinc-600">0</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="text-base font-black text-zinc-300">Belum ada riwayat</h3>
                <p className="text-xs text-zinc-600 max-w-xs leading-relaxed">
                  Tonton anime dan riwayatmu akan otomatis muncul di sini.
                </p>
              </div>
              <Link
                href="/"
                className="mt-1 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-bold
                           hover:opacity-90 active:scale-95 transition-all"
              >
                Jelajahi Anime
              </Link>
            </div>
          )}

          {/* No results */}
          {mounted && items.length > 0 && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <Search className="w-8 h-8 text-zinc-700" />
              <p className="text-sm font-bold text-zinc-400">Tidak ditemukan</p>
              <p className="text-xs text-zinc-600">
                Tidak ada anime dengan judul &ldquo;{query}&rdquo;
              </p>
            </div>
          )}

          {/* Grouped content */}
          {mounted && groups.length > 0 && (
            <div className="flex flex-col gap-10">
              {groups.map((group, gi) => (
                <div key={group.label} className="flex flex-col gap-4">

                  {/* Group header */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-zinc-500 uppercase tracking-[0.12em]">
                      {group.label}
                    </span>
                    <div className="flex-1 h-px bg-zinc-900" />
                    <span className="text-[10px] font-semibold text-zinc-700">
                      {group.items.length} judul
                    </span>
                  </div>

                  {/* Grid */}
                  {view === "grid" && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                      {group.items.map((item, i) => (
                        <GridCard
                          key={`${item.malId}-${item.episode}`}
                          item={item}
                          delay={Math.min((gi * 10 + i) * 40, 400)}
                          onRemove={handleRemove}
                        />
                      ))}
                    </div>
                  )}

                  {/* List */}
                  {view === "list" && (
                    <div className="flex flex-col divide-y divide-zinc-900/60">
                      {group.items.map((item, i) => (
                        <ListRow
                          key={`${item.malId}-${item.episode}`}
                          item={item}
                          delay={Math.min((gi * 10 + i) * 30, 300)}
                          onRemove={handleRemove}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Grid Card ────────────────────────────────────────────────────────────────

function GridCard({
  item, delay, onRemove,
}: {
  item: HistoryItem;
  delay: number;
  onRemove: (malId: string, episode: number) => void;
}) {
  return (
    <div
      className="anim-card group relative flex flex-col gap-2"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800/60 shadow-lg">
        <Image
          src={item.poster || "/placeholder-poster.png"}
          alt={item.title}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 15vw"
          className="object-cover transition-transform duration-500 group-hover:scale-[1.06]"
        />

        {/* Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

        {/* Play overlay */}
        <Link
          href={`/watch/${item.malId}/${item.episode}`}
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        >
          <div className="w-11 h-11 rounded-full bg-white/12 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-xl">
            <Play className="w-4 h-4 text-white fill-white ml-0.5" />
          </div>
        </Link>

        {/* Episode badge */}
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md bg-black/75 backdrop-blur text-[10px] font-black text-white tracking-wide">
          EP {item.episode}
        </div>

        {/* Remove */}
        <button
          onClick={() => onRemove(item.malId, item.episode)}
          className="absolute top-2 right-2 w-6 h-6 rounded-lg bg-black/70 backdrop-blur flex items-center justify-center
                     opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/80 active:scale-90"
        >
          <Trash2 className="w-3 h-3 text-white" />
        </button>
      </div>

      <div className="flex flex-col gap-0.5 px-0.5">
        <p className="text-[11px] font-bold text-zinc-300 line-clamp-2 leading-snug group-hover:text-white transition-colors">
          {item.title}
        </p>
        <p className="text-[10px] text-zinc-600">{timeAgo(item.watchedAt)}</p>
      </div>
    </div>
  );
}

// ─── List Row ─────────────────────────────────────────────────────────────────

function ListRow({
  item, delay, onRemove,
}: {
  item: HistoryItem;
  delay: number;
  onRemove: (malId: string, episode: number) => void;
}) {
  return (
    <div
      className="anim-card group flex items-center gap-4 py-3 px-2 rounded-xl hover:bg-zinc-900/50 transition-all"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Poster thumb */}
      <div className="relative w-12 h-16 rounded-lg overflow-hidden bg-zinc-900 shrink-0 border border-zinc-800/50">
        <Image
          src={item.poster || "/placeholder-poster.png"}
          alt={item.title}
          fill
          sizes="48px"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="text-sm font-bold text-zinc-200 truncate group-hover:text-white transition-colors">
          {item.title}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-accent bg-accent/10 rounded px-1.5 py-0.5 border border-accent/20">
            EP {item.episode}
          </span>
          <span className="text-[11px] text-zinc-600">{timeAgo(item.watchedAt)}</span>
        </div>
      </div>

      {/* Actions — visible on hover */}
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Link
          href={`/watch/${item.malId}/${item.episode}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-bold
                     hover:opacity-90 active:scale-95 transition-all"
        >
          <Play className="w-3 h-3 fill-white" />
          Lanjutkan
        </Link>
        <button
          onClick={() => onRemove(item.malId, item.episode)}
          className="w-7 h-7 rounded-lg border border-zinc-800 flex items-center justify-center text-zinc-600
                     hover:text-red-400 hover:border-red-900 hover:bg-red-500/10 active:scale-90 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}