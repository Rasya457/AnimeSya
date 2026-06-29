"use client";

import React, { useMemo, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Settings, Award, MessageCircle, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { getHistoryKey } from "@/lib/historyKey";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  type Timestamp,
} from "firebase/firestore";

interface HistoryItem {
  malId: string;
  title: string;
  poster: string;
  episode: number;
  watchedAt: number;
}

interface UserComment {
  id: string;
  malId: string;
  episode: number;
  parentId: string | null;
  text: string;
  createdAt: number;
}

// Ambil history dari localStorage (per-user)
function getWatchHistory(userId?: string | null): HistoryItem[] {
  try {
    const key = getHistoryKey(userId);
    return JSON.parse(localStorage.getItem(key) ?? "[]");
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

// ─── small helpers ────────────────────────────────────────────────────────────

function getIdTag(id?: string | null): string {
  if (!id) return "0000000";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 10000000;
  }
  return Math.abs(hash).toString().padStart(7, "0");
}

function getJoinedMonths(joinedAt?: string | number): number | null {
  if (!joinedAt) return null;
  const d = new Date(joinedAt);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  return Math.max(0, months);
}

function getRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  const hours   = Math.floor(diffMs / 3600000);
  const days    = Math.floor(diffMs / 86400000);
  if (minutes < 1)  return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  if (hours < 24)   return `${hours} jam lalu`;
  if (days < 30)    return `${days} hari lalu`;
  return `${Math.floor(days / 30)} bulan lalu`;
}

type Tab = "semua" | "komentar";

export default function ProfilePage() {
  const router = useRouter();
  const { user, watchlist, isAuthenticated } = useAuthStore();

  const [history, setHistory]           = useState<HistoryItem[]>([]);
  const [tab, setTab]                   = useState<Tab>("semua");
  const [userComments, setUserComments] = useState<UserComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);

  // Redirect if guest
  useEffect(() => {
    if (!isAuthenticated || !user) router.push("/login");
  }, [isAuthenticated, user, router]);

  // Ambil history dari localStorage (per user)
  useEffect(() => {
    setHistory(getWatchHistory(user?.id));
  }, [user?.id]);

  // Ambil semua komentar milik user dari Firestore (realtime)
  useEffect(() => {
    if (!user?.id) return;
    setCommentsLoading(true);
    const q = query(
      collection(db, "comments"),
      where("authorId", "==", user.id)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: UserComment[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const ts   = data.createdAt as Timestamp | null;
          return {
            id:       d.id,
            malId:    data.malId    ?? "",
            episode:  data.episode  ?? 0,
            parentId: data.parentId ?? null,
            text:     data.text     ?? "",
            createdAt: ts ? ts.toMillis() : Date.now(),
          };
        });
        // terbaru di atas
        setUserComments(list.sort((a, b) => b.createdAt - a.createdAt));
        setCommentsLoading(false);
      },
      () => setCommentsLoading(false)
    );
    return unsub;
  }, [user?.id]);

  const episodesWatched = history.length;
  const hoursWatched    = useMemo(() => ((episodesWatched * 24) / 60).toFixed(1), [episodesWatched]);
  const levelInfo       = useMemo(() => getLevelInfo(episodesWatched), [episodesWatched]);
  const sortedHistory   = useMemo(
    () => [...history].sort((a, b) => b.watchedAt - a.watchedAt),
    [history]
  );

  const idTag        = useMemo(() => getIdTag(user?.id), [user?.id]);
  const joinedMonths = useMemo(() => getJoinedMonths(user?.joinedAt), [user?.joinedAt]);

  // Jumlah komentar real dari Firestore
  const commentsCount = userComments.length;

  // Map malId → {title, poster} dari history buat lookup di feed komentar
  const animeMap = useMemo(() => {
    const map = new Map<string, { title: string; poster: string }>();
    for (const h of history) {
      if (!map.has(h.malId)) map.set(h.malId, { title: h.title, poster: h.poster });
    }
    return map;
  }, [history]);

  if (!user) return null;

  return (
    <div className="w-full flex flex-col gap-8 select-none pb-8">

      {/* 1. Banner + avatar */}
      <div className="relative w-full">
        <div className="relative w-full h-44 md:h-52 overflow-hidden rounded-b-3xl">
          {user.avatar ? (
            <Image
              src={user.avatar}
              alt=""
              fill
              className="object-cover blur-2xl scale-125 opacity-60"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-accent/15 via-zinc-900 to-zinc-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/55 to-zinc-950" />

          {/* top bar */}
          <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 md:px-6 py-4">
            <button
              onClick={() => router.back()}
              aria-label="Back"
              className="w-9 h-9 rounded-full bg-black/30 border border-white/10 flex items-center justify-center text-zinc-100 hover:bg-black/50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <Link
              href="/profile/settings"
              className="flex items-center gap-1.5 text-xs font-bold text-zinc-200 hover:text-accent transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </Link>
          </div>
        </div>

        {/* Avatar overlap */}
        <div className="flex flex-col items-center -mt-12 px-6">
          <div className="relative">
            {user.avatar ? (
              <Image
                src={user.avatar}
                alt={user.name}
                width={96}
                height={96}
                className="w-24 h-24 rounded-full object-cover border-2 border-accent shadow-lg shrink-0"
              />
            ) : (
              <div className="w-24 h-24 rounded-full border-2 border-accent bg-zinc-800 flex items-center justify-center text-3xl font-black text-accent shrink-0">
                {user.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <Link
              href="/profile/settings"
              aria-label="Change profile photo"
              className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-accent border-2 border-zinc-950 flex items-center justify-center text-zinc-950"
            >
              <Camera className="w-3.5 h-3.5" />
            </Link>
          </div>

          <h2 className="mt-3 text-xl md:text-2xl font-black text-zinc-100 flex items-baseline gap-1.5">
            {user.name}
            <span className="text-xs font-semibold text-zinc-500">#{idTag}</span>
          </h2>
          <p className="text-xs text-zinc-500">{user.email}</p>

          {/* Level pill */}
          <div className="mt-3 px-3 py-1 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-600/10 border border-amber-500/30 flex items-center gap-1.5">
            <span className="text-sm leading-none">{levelInfo.emoji}</span>
            <span className="text-[11px] font-black text-amber-400 uppercase tracking-wide">
              Lvl. {levelInfo.level} · {levelInfo.label}
            </span>
          </div>

          {levelInfo.next && (
            <div className="w-36 mt-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-700"
                style={{ width: `${levelInfo.progress}%` }}
              />
            </div>
          )}

          {/* Stats row */}
          <div className="w-full max-w-md mt-5 grid grid-cols-4 divide-x divide-zinc-800">
            <InlineStat value={episodesWatched} label="Episodes" />
            <InlineStat value={commentsCount}   label="Komentar" />
            <InlineStat value={joinedMonths ?? (user.joinedAt || "-")} label="Bulan" />
            <InlineStat value={watchlist.length} label="Watchlist" />
          </div>
          <p className="text-[10px] text-zinc-600 mt-1">{hoursWatched}h total ditonton</p>
        </div>
      </div>

      {/* 2. Tabs: Semua / Komentar */}
      <div className="px-6 md:px-12">
        <div className="flex items-center gap-6 border-b border-zinc-800">
          <TabButton active={tab === "semua"} onClick={() => setTab("semua")}>
            Semua
          </TabButton>
          <TabButton active={tab === "komentar"} onClick={() => setTab("komentar")}>
            Komentar
            {commentsCount > 0 && (
              <span className="ml-1.5 text-[10px] font-black text-accent bg-accent/10 px-1.5 py-0.5 rounded-full">
                {commentsCount}
              </span>
            )}
          </TabButton>
        </div>

        <div className="mt-6">
          {tab === "semua" ? (
            sortedHistory.length > 0 ? (
              <div className="flex flex-col gap-5">
                {sortedHistory.map((item, i) => (
                  <HistoryFeedItem key={`${item.malId}-${item.watchedAt}-${i}`} item={item} user={user} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Award className="w-7 h-7" />}
                title="Belum ada riwayat tontonan"
                desc="Mulai nonton anime buat lihat aktivitas lu di sini"
              />
            )
          ) : (
            /* ── Tab Komentar ── */
            commentsLoading ? (
              <div className="flex items-center justify-center py-12 text-zinc-500 gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-semibold">Memuat komentar…</span>
              </div>
            ) : userComments.length > 0 ? (
              <div className="flex flex-col gap-5">
                {userComments.map((comment) => (
                  <CommentFeedItem
                    key={comment.id}
                    comment={comment}
                    animeMap={animeMap}
                    user={user}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<MessageCircle className="w-7 h-7" />}
                title="Belum ada komentar"
                desc="Komentar yang lu tulis bakal muncul di sini"
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function InlineStat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1">
      <span className="text-base font-black text-zinc-100">{value}</span>
      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative pb-3 text-sm font-bold transition-colors flex items-center ${
        active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
      {active && <span className="absolute left-0 -bottom-px w-full h-0.5 bg-accent rounded-full" />}
    </button>
  );
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 border border-dashed border-zinc-800 rounded-2xl text-zinc-500 gap-3 text-center">
      {icon}
      <div className="flex flex-col">
        <span className="text-xs font-bold text-zinc-400">{title}</span>
        <span className="text-[10px] text-zinc-500">{desc}</span>
      </div>
    </div>
  );
}

function HistoryFeedItem({ item, user }: { item: HistoryItem; user: any }) {
  return (
    <div className="flex flex-col gap-3 pb-5 border-b border-zinc-900 last:border-none last:pb-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {user.avatar ? (
            <Image
              src={user.avatar}
              alt={user.name}
              width={32}
              height={32}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-accent">
              {user.name?.[0]?.toUpperCase() ?? "U"}
            </div>
          )}
          <span className="text-sm font-bold text-zinc-200">{user.name}</span>
        </div>
        <span className="text-[10px] text-zinc-500">{getRelativeTime(item.watchedAt)}</span>
      </div>

      <Link href={`/anime/${item.malId}`} className="flex items-center gap-3 group">
        <Image
          src={item.poster}
          alt={item.title}
          width={48}
          height={64}
          className="w-12 h-16 rounded-lg object-cover shrink-0"
        />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm font-bold text-zinc-100 group-hover:text-accent transition-colors line-clamp-1">
            {item.title}
          </span>
          <span className="text-xs text-zinc-500">Episode {item.episode}</span>
        </div>
      </Link>
    </div>
  );
}

function CommentFeedItem({
  comment,
  animeMap,
  user,
}: {
  comment: UserComment;
  animeMap: Map<string, { title: string; poster: string }>;
  user: any;
}) {
  const anime = animeMap.get(comment.malId);

  return (
    <div className="flex flex-col gap-3 pb-5 border-b border-zinc-900 last:border-none last:pb-0">
      {/* User row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {user.avatar ? (
            <Image
              src={user.avatar}
              alt={user.name}
              width={32}
              height={32}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-accent">
              {user.name?.[0]?.toUpperCase() ?? "U"}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-zinc-200">{user.name}</span>
            {comment.parentId && (
              <span className="text-[10px] text-zinc-500 font-semibold">membalas komentar</span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-zinc-500">{getRelativeTime(comment.createdAt)}</span>
      </div>

      {/* Link ke episode yang dikomentar */}
      <Link
        href={`/watch/${comment.malId}/${comment.episode}`}
        className="flex items-start gap-3 group"
      >
        {anime?.poster ? (
          <Image
            src={anime.poster}
            alt={anime.title}
            width={48}
            height={64}
            className="w-12 h-16 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-12 h-16 rounded-lg bg-zinc-800 shrink-0 flex items-center justify-center">
            <MessageCircle className="w-4 h-4 text-zinc-600" />
          </div>
        )}

        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-sm font-bold text-zinc-100 group-hover:text-accent transition-colors line-clamp-1">
            {anime?.title ?? `Anime #${comment.malId}`}
          </span>
          <span className="text-xs text-zinc-500">Episode {comment.episode}</span>
          {/* Bubble komentar */}
          <div className="mt-1 px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/40">
            <p className="text-xs text-zinc-300 leading-relaxed line-clamp-3 whitespace-pre-wrap break-words">
              {comment.text}
            </p>
          </div>
        </div>
      </Link>
    </div>
  );
}