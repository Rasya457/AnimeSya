'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import NextImage from 'next/image'
import { useParams } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, RefreshCw,
  ArrowLeft, Loader2, Send, MessageCircle, Trash2,
  ThumbsUp, ThumbsDown, Download, Share2, Flag,
  ChevronDown, SlidersHorizontal, Maximize, X, Check
} from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { db } from '@/lib/firebase'
import {
  collection, query, where, onSnapshot,
  addDoc, deleteDoc, doc, serverTimestamp,
  type Timestamp,
} from 'firebase/firestore'
import { useToast } from '@/components/ui/Toast'
import { getHistoryKey } from '@/lib/historyKey'

type Server = 'sub' | 'dub' | 'indo'

const EPISODE_DURATION_MS = 24 * 60 * 1000
const SAVE_INTERVAL_MS = 15_000

interface HistoryEntry {
  malId: string
  title: string
  poster: string
  episode: number
  watchedAt: number
  progress: number
  totalEpisodes?: number
  watchedEpisodes?: number[]
}

interface Comment {
  id: string
  parentId: string | null
  authorId: string
  authorName: string
  text: string
  createdAt: number
}

interface DownloadHost {
  name: string
  url: string
}

interface DownloadQualityGroup {
  format: string
  quality: string
  sizeLabel: string | null
  hosts: DownloadHost[]
}

// ─── Hook: nama dari authStore ────────────────────────────────────────────────
// Helper: warna avatar berdasarkan nama
function getAvatarBgColor(name: string): string {
  const charCode = name.charCodeAt(0) || 0
  const colors = [
    'bg-emerald-600', 'bg-sky-600', 'bg-indigo-600', 'bg-violet-600',
    'bg-purple-600', 'bg-pink-600', 'bg-rose-600', 'bg-red-600',
    'bg-orange-600', 'bg-amber-600',
  ]
  return colors[charCode % colors.length]
}

// ─── Helper: simpan history (per-user) ───────────────────────────────────────
function persistHistory(entry: HistoryEntry, userId?: string | null) {
  const key = getHistoryKey(userId)
  try {
    const prev: HistoryEntry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const existing = prev.find(h => h.malId === entry.malId)
    const prevWatched = existing?.watchedEpisodes ?? (existing ? [existing.episode] : [])
    const watchedEpisodes = [...new Set([...prevWatched, entry.episode])]
    const updated: HistoryEntry = {
      ...entry,
      watchedEpisodes,
      progress: Math.max(entry.progress, existing?.progress ?? 0),
    }
    const next = [updated, ...prev.filter(h => h.malId !== entry.malId)].slice(0, 30)
    localStorage.setItem(key, JSON.stringify(next))
  } catch { /* silent */ }
}

// ─── Helper: like/dislike persist ─────────────────────────────────────────────
const REACTION_KEY_PREFIX = 'watch-reaction'

interface ReactionState {
  liked: boolean
  disliked: boolean
}

// Angka awal like/dislike yang konsisten per anime+episode (tidak random tiap reload)
function seededCount(seed: string, min: number, max: number): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return min + (Math.abs(hash) % (max - min))
}

function loadReaction(malId: string, epNum: number): ReactionState {
  try {
    const stored = localStorage.getItem(`${REACTION_KEY_PREFIX}-${malId}-${epNum}`)
    if (!stored) return { liked: false, disliked: false }
    const parsed = JSON.parse(stored)
    return { liked: !!parsed.liked, disliked: !!parsed.disliked }
  } catch {
    return { liked: false, disliked: false }
  }
}

function saveReaction(malId: string, epNum: number, reaction: ReactionState) {
  try {
    localStorage.setItem(`${REACTION_KEY_PREFIX}-${malId}-${epNum}`, JSON.stringify(reaction))
  } catch { /* silent */ }
}

// ─── Persist pilihan kualitas (server Sub Indo) biar konsisten antar episode ──
const QUALITY_KEY = 'watch-quality-indo'

function loadQuality(): 1080 | 720 | 480 | 360 {
  try {
    const stored = localStorage.getItem(QUALITY_KEY)
    if (stored === '1080' || stored === '720' || stored === '480' || stored === '360') {
      return Number(stored) as 1080 | 720 | 480 | 360
    }
  } catch { /* silent */ }
  return 720  // default 720p
}

function saveQuality(q: 1080 | 720 | 480 | 360) {
  try {
    localStorage.setItem(QUALITY_KEY, String(q))
  } catch { /* silent */ }
}

// ─── URL helpers ──────────────────────────────────────────────────────────────
function subUrl(malId: string, ep: number) {
  return `https://megaplay.buzz/stream/mal/${malId}/${ep}/sub`
}
function dbUrl(malId: string, ep: number) {
  return `https://megaplay.buzz/stream/mal/${malId}/${ep}/dub`
}

// Label tampilan buat badge "via <source>" — tinggal nambah entry kalau ada
// adapter baru di backend (Sokuja/Oploverz dst).
const SOURCE_LABELS: Record<string, string> = {
  otakudesu: 'Otakudesu',
  nontonanimeid: 'NontonAnimeID',
  sokuja: 'Sokuja',
}

// ─── Loading overlay ──────────────────────────────────────────────────────────
function LoadingOverlay({ label = 'Memuat player…' }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#07070f]/90 gap-3 backdrop-blur-sm">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-2 border-emerald-500/20 border-t-emerald-500 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-teal-500 animate-spin" />
        </div>
      </div>
      <span className="text-xs text-emerald-300/60 font-bold uppercase tracking-wider">{label}</span>
    </div>
  )
}

// ─── Comments Section ─────────────────────────────────────────────────────────
// Firestore (collection "comments") — shared antar semua user, bukan
// localStorage lagi. Reply cuma 1 level (kayak YouTube): parentId nunjuk ke
// id komentar top-level, reply gak bisa di-reply lagi.
//
// Query cuma pakai 1 equality filter (episodeKey) tanpa orderBy di Firestore
// — sengaja, biar gak butuh composite index dan gak ada quirk sorting pas
// serverTimestamp() masih pending di optimistic write. Sorting dikerjain di
// client (sortedTopLevel/repliesByParent di bawah).
function CommentSection({ malId, epNum }: { malId: string; epNum: number }) {
  const { user } = useAuthStore()
  const episodeKey = `${malId}_${epNum}`

  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<'top' | 'newest'>('newest')

  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replySubmitting, setReplySubmitting] = useState(false)

  useEffect(() => {
    setCommentsLoading(true)
    const q = query(collection(db, 'comments'), where('episodeKey', '==', episodeKey))
    const unsub = onSnapshot(
      q,
      snap => {
        const list: Comment[] = snap.docs.map(d => {
          const data = d.data() as any
          const ts = data.createdAt as Timestamp | null
          return {
            id: d.id,
            parentId: data.parentId ?? null,
            authorId: data.authorId,
            authorName: data.authorName ?? 'Pengguna',
            text: data.text ?? '',
            createdAt: ts ? ts.toMillis() : Date.now(), // pending write: fallback ke now
          }
        })
        setComments(list)
        setCommentsLoading(false)
      },
      () => setCommentsLoading(false),
    )
    return unsub
  }, [episodeKey])

  const topLevel = useMemo(() => comments.filter(c => !c.parentId), [comments])

  const repliesByParent = useMemo(() => {
    const map = new Map<string, Comment[]>()
    for (const c of comments) {
      if (!c.parentId) continue
      const arr = map.get(c.parentId) ?? []
      arr.push(c)
      map.set(c.parentId, arr)
    }
    for (const arr of map.values()) arr.sort((a, b) => a.createdAt - b.createdAt)
    return map
  }, [comments])

  const sortedTopLevel = useMemo(() => {
    if (activeTab === 'newest') {
      return [...topLevel].sort((a, b) => b.createdAt - a.createdAt)
    }
    // "Top" — belum ada like/dislike, jadi proxy-nya: jumlah reply dulu,
    // baru panjang teks (high-effort), baru terbaru. Gampang diganti ke
    // like-count beneran nanti.
    return [...topLevel].sort((a, b) => {
      const ra = repliesByParent.get(a.id)?.length ?? 0
      const rb = repliesByParent.get(b.id)?.length ?? 0
      return rb - ra || b.text.length - a.text.length || b.createdAt - a.createdAt
    })
  }, [topLevel, repliesByParent, activeTab])

  async function handleSubmit() {
    if (!commentText.trim() || !user || submitting) return
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'comments'), {
        malId, episode: epNum, episodeKey,
        parentId: null,
        authorId: user.id,
        authorName: user.name,
        text: commentText.trim(),
        createdAt: serverTimestamp(),
      })
      setCommentText('')
    } catch {
      // biarin teksnya tetep di textarea kalau gagal kirim, jangan ke-reset
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitReply(parentId: string) {
    if (!replyText.trim() || !user || replySubmitting) return
    setReplySubmitting(true)
    try {
      await addDoc(collection(db, 'comments'), {
        malId, episode: epNum, episodeKey,
        parentId,
        authorId: user.id,
        authorName: user.name,
        text: replyText.trim(),
        createdAt: serverTimestamp(),
      })
      setReplyText('')
      setReplyingTo(null)
    } catch {
      // biarin input reply tetep kebuka kalau gagal kirim
    } finally {
      setReplySubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    try { await deleteDoc(doc(db, 'comments', id)) } catch { /* silent */ }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const totalCommentCount = comments.length

  function renderComment(c: Comment, isReply: boolean) {
    const isOwn = !!user && c.authorId === user.id
    const replies = isReply ? [] : repliesByParent.get(c.id) ?? []

    return (
      <div
        key={c.id}
        className={`rounded-2xl p-3.5 flex gap-3 border transition-colors ${
          isOwn ? 'bg-emerald-950/20 border-emerald-800/20' : 'bg-[#0f0f1a] border-white/5'
        }`}
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold text-white uppercase select-none flex-shrink-0 ${getAvatarBgColor(c.authorName)}`}>
          {c.authorName[0]}
        </div>
        <div className="flex-1 flex flex-col gap-1.5 min-w-0 min-h-0">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-white">{c.authorName}</span>
              {isOwn && (
                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-900/30 border border-emerald-700/30 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Kamu</span>
              )}
              <span className="text-[10px] text-zinc-650 font-semibold">{formatDate(c.createdAt)}</span>
            </div>
            {isOwn && (
              <button
                onClick={() => handleDelete(c.id)}
                className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-950/40 transition-colors cursor-pointer flex-shrink-0"
                title="Hapus komentar"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <p className="text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">{c.text}</p>

          {!isReply && (
            <button
              onClick={() => { setReplyingTo(replyingTo === c.id ? null : c.id); setReplyText('') }}
              disabled={!user}
              className="self-start text-[11px] font-bold text-zinc-500 hover:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer mt-0.5"
            >
              {replyingTo === c.id ? 'Batal' : 'Balas'}
            </button>
          )}

          {!isReply && replyingTo === c.id && user && (
            <div className="flex items-start gap-2 mt-1.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white uppercase select-none flex-shrink-0 mt-0.5 ${getAvatarBgColor(user.name)}`}>
                {user.name[0]}
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitReply(c.id) }
                  }}
                  placeholder={`Balas ${c.authorName}...`}
                  rows={1}
                  maxLength={500}
                  autoFocus
                  className="w-full bg-[#07070f] border border-white/5 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all resize-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleSubmitReply(c.id)}
                    disabled={!replyText.trim() || replySubmitting}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-white text-[11px] font-bold cursor-pointer active:scale-95"
                  >
                    <Send className="w-3 h-3" />
                    Kirim
                  </button>
                </div>
              </div>
            </div>
          )}

          {!isReply && replies.length > 0 && (
            <div className="flex flex-col gap-2.5 mt-2 pl-3 border-l-2 border-white/5">
              {replies.map(r => renderComment(r, true))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-3.5 h-3.5 text-white" />
        </div>
        <h3 className="text-sm font-extrabold text-white">
          {commentsLoading
            ? 'Memuat komentar…'
            : totalCommentCount === 0 ? 'Belum ada komentar' : `${totalCommentCount.toLocaleString('id-ID')} Komentar`}
        </h3>
      </div>

      {/* Tab */}
      <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-3">
        <div className="flex items-center gap-1 bg-[#0f0f1a] p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setActiveTab('top')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'top'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Top
          </button>
          <button
            onClick={() => setActiveTab('newest')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'newest'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Terbaru
          </button>
        </div>
      </div>

      {/* Input — komentar baru */}
      {user ? (
        <div className="flex items-start gap-2.5 bg-[#0f0f1a] border border-white/5 rounded-2xl p-3.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold text-white uppercase select-none flex-shrink-0 mt-0.5 ${getAvatarBgColor(user.name)}`}>
            {user.name[0]}
          </div>
          <div className="flex-1 flex flex-col gap-2">
            <span className="text-[10px] font-bold text-zinc-400">{user.name}</span>
            <textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
              }}
              placeholder="Tulis komentar kamu..."
              rows={2}
              maxLength={500}
              className="w-full bg-[#07070f] border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-600">{commentText.length}/500</span>
              <button
                onClick={handleSubmit}
                disabled={!commentText.trim() || submitting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-white text-xs font-bold cursor-pointer active:scale-95 shadow-md shadow-emerald-500/20"
              >
                <Send className="w-3 h-3" />
                <span>Kirim</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 bg-[#0f0f1a] border border-white/5 rounded-2xl p-4 text-xs text-zinc-500 font-medium">
          Login dulu buat ikut komentar
        </div>
      )}

      {/* Comment list */}
      <div className="flex flex-col gap-2.5 mt-1">
        {!commentsLoading && sortedTopLevel.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-zinc-600">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/10 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 opacity-40" />
            </div>
            <p className="text-xs font-medium">Jadilah yang pertama berkomentar!</p>
          </div>
        )}
        {sortedTopLevel.map(c => renderComment(c, false))}
      </div>
    </section>
  )
}

// ─── Main Watch Client Component ──────────────────────────────────────────────
export default function WatchClient() {
  const params = useParams()
  const malId = String(params.animeId)
  const epNum = Number(params.episode)
  const { toast } = useToast()
  const { user } = useAuthStore()

  const [server, setServer] = useState<Server>('sub')
  const [iframeKey, setIframeKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [airedEpisodes, setAiredEpisodes] = useState<number>(0)

  const [indoSrc, setIndoSrc] = useState<string | null>(null)
  const [indoLoading, setIndoLoading] = useState(false)
  const [indoError, setIndoError] = useState<string | null>(null)
  const [indoManual, setIndoManual] = useState('')
  const [indoNotice, setIndoNotice] = useState<string | null>(null)
  const [indoEpTitle, setIndoEpTitle] = useState<string | null>(null)
  const [infoReady, setInfoReady] = useState(false)

  // ── Quality selector (indo server only) — Otakudesu maks 720p, tapi
  // Samehadaku bisa 1080p, jadi semua tier dimunculkan. Default 720p. ─────────
  const [quality, setQuality] = useState<1080 | 720 | 480 | 360>(720)
  const [availableQualities, setAvailableQualities] = useState<number[]>([])

  // Load kualitas tersimpan sekali pas mount, biar konsisten antar episode &
  // antar sesi nonton (gak reset ke 720 tiap pindah episode/anime) ───────────
  useEffect(() => {
    setQuality(loadQuality())
  }, [])

  // ── Direct stream URL (zero-iframe, zero-ad path) ──────────────────────────
  const [directUrl, setDirectUrl] = useState<string | null>(null)
  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [directLoading, setDirectLoading] = useState(false)

  // ── Multi-source: source mana yang lagi aktif buat server Indo, + referer
  // override-nya (URL episode asli di source itu, dipakai proxy-video biar
  // hotlink-check-nya akurat — beda domain dari Otakudesu) ───────────────────
  const [indoSource, setIndoSource] = useState<string>('otakudesu')
  const [indoReferer, setIndoReferer] = useState<string | null>(null)

  // ── Download modal state ───────────────────────────────────────────────────
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [downloadGroups, setDownloadGroups] = useState<DownloadQualityGroup[] | null>(null)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<any>(null)
  const isHoveringPlayer = useRef(false)
  const indoFetchSeqRef = useRef(0)
  const playerContainerRef = useRef<HTMLDivElement>(null)

  // ── Tracking refs ──────────────────────────────────────────────────────────
  const watchStartRef = useRef<number | null>(null)
  const watchedMsRef = useRef<number>(0)
  const durationMsRef = useRef<number>(EPISODE_DURATION_MS)
  const progressRef = useRef<number>(0)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const usingPostMsgRef = useRef<boolean>(false)
  const currentTimeRef = useRef<number>(0)

  const animeInfoRef = useRef<{ title: string; altTitles?: string[]; poster: string; totalEpisodes?: number }>({
    title: 'Unknown',
    poster: '',
  })
  const indoEpisodesRef = useRef<{ episode: number; title: string; url: string }[]>([])
  const indoMalIdRef = useRef<string>('')

  // ── UI states ──────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [megaplayError, setMegaplayError] = useState(false)
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [dislikeCount, setDislikeCount] = useState(0)
  const likeBaseRef = useRef(0)
  const dislikeBaseRef = useRef(0)
  const [isDescExpanded, setIsDescExpanded] = useState(false)
  const [animeDetails, setAnimeDetails] = useState<{
    title: string
    poster: string
    synopsis: string
    aired: string
    views: string
    totalEpisodes?: number
  } | null>(null)
  const [watchedEpNumbers, setWatchedEpNumbers] = useState<number[]>([])
  const [episodeList, setEpisodeList] = useState<{ number: number; title: string; locked: boolean }[]>([])

  // ── Derived values ─────────────────────────────────────────────────────────
  const canGoPrev = epNum > 1
  const canGoNext = airedEpisodes > 0 && isFinite(airedEpisodes) && epNum < airedEpisodes

  const prevHref = canGoPrev ? `/watch/${malId}/${epNum - 1}` : null
  const nextHref = canGoNext ? `/watch/${malId}/${epNum + 1}` : null

  const currentSrc = server === 'indo'
    ? indoSrc
    : server === 'dub'
      ? dbUrl(malId, epNum)
      : subUrl(malId, epNum)

  // ── Segment helpers ────────────────────────────────────────────────────────
  function startSegment() {
    if (watchStartRef.current === null) watchStartRef.current = Date.now()
  }
  function pauseSegment() {
    if (watchStartRef.current !== null) {
      watchedMsRef.current += Date.now() - watchStartRef.current
      watchStartRef.current = null
    }
  }
  function calcWallProgress(): number {
    const segMs = watchStartRef.current !== null ? Date.now() - watchStartRef.current : 0
    const totalMs = watchedMsRef.current + segMs
    return Math.min(100, Math.round((totalMs / durationMsRef.current) * 100))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  function save(progress: number) {
    persistHistory({
      ...animeInfoRef.current,
      malId,
      episode: epNum,
      watchedAt: Date.now(),
      progress,
    }, user?.id)
    progressRef.current = progress
    try {
      const key = getHistoryKey(user?.id)
      const history: HistoryEntry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
      const existing = history.find(h => h.malId === malId)
      if (existing?.watchedEpisodes) setWatchedEpNumbers(existing.watchedEpisodes)
    } catch { /* silent */ }
  }

  // ── Tracking ───────────────────────────────────────────────────────────────
  function startTracking() {
    stopTracking()
    startSegment()
    saveTimerRef.current = setInterval(() => {
      const pct = usingPostMsgRef.current ? progressRef.current : calcWallProgress()
      save(Math.max(pct, progressRef.current))
    }, SAVE_INTERVAL_MS)
  }
  function stopTracking() {
    pauseSegment()
    if (saveTimerRef.current) {
      clearInterval(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  function toggleFullscreen() {
    const container = playerContainerRef.current
    if (!container) return
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  // ── Reset + fetch info on episode change ───────────────────────────────────
  useEffect(() => {
    watchedMsRef.current = 0
    watchStartRef.current = null
    usingPostMsgRef.current = false
    durationMsRef.current = EPISODE_DURATION_MS
    setAiredEpisodes(0)
    setIndoSrc(null)
    setIndoError(null)
    setIndoManual('')
    setIndoNotice(null)
    setIndoEpTitle(null)
    setInfoReady(false)
    setIsPlaying(false)
    setDirectUrl(null)
    setDirectLoading(false)
    setAvailableQualities([])
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    if (indoMalIdRef.current !== malId) indoEpisodesRef.current = []

    likeBaseRef.current = seededCount(`${malId}-${epNum}-like`, 850, 12000)
    dislikeBaseRef.current = seededCount(`${malId}-${epNum}-dislike`, 5, 180)
    const savedReaction = loadReaction(malId, epNum)
    setLiked(savedReaction.liked)
    setDisliked(savedReaction.disliked)
    setLikeCount(likeBaseRef.current + (savedReaction.liked ? 1 : 0))
    setDislikeCount(dislikeBaseRef.current + (savedReaction.disliked ? 1 : 0))

    try {
      const key = getHistoryKey(user?.id)
      const history: HistoryEntry[] = JSON.parse(localStorage.getItem(key) ?? '[]')
      const existing = history.find(h => h.malId === malId)
      if (existing?.watchedEpisodes) {
        setWatchedEpNumbers(existing.watchedEpisodes)
      } else {
        setWatchedEpNumbers([])
      }
      const specific = history.find(h => h.malId === malId && h.episode === epNum)
      progressRef.current = specific?.progress ?? 0
    } catch {
      progressRef.current = 0
      setWatchedEpNumbers([])
    }

    async function fetchInfo() {
      try {
        const res = await fetch(`/api/proxy/anime/${malId}`)
        const json = await res.json()
        if (json.statusCode !== 200 || !json.data) {
          throw new Error("Failed to load anime details")
        }
        const anime = json.data

        durationMsRef.current = EPISODE_DURATION_MS

        const plannedTotal = typeof anime.totalEpisodes === 'number' ? anime.totalEpisodes : null
        const synonyms = anime.alternativeTitle ? [anime.alternativeTitle] : []

        animeInfoRef.current = {
          title: anime.title ?? 'Unknown',
          altTitles: synonyms.length > 0 ? synonyms : undefined,
          poster: anime.poster ?? '',
          totalEpisodes: plannedTotal ?? undefined,
        }

        setAnimeDetails({
          title: anime.title ?? 'Unknown',
          poster: anime.poster ?? '',
          synopsis: anime.synopsis ?? 'Tidak ada deskripsi.',
          aired: anime.aired ?? 'Unknown',
          views: Math.floor(100000 + (parseInt(malId) || 0) * 7.5).toLocaleString('id-ID'),
          totalEpisodes: plannedTotal ?? undefined,
        })

        save(progressRef.current)

        const aired = Array.isArray(anime.episodes) ? anime.episodes.length : (plannedTotal ?? 0)
        setAiredEpisodes(aired)
      } catch (err) {
        console.error("Error fetching watch page details:", err)
      } finally {
        setInfoReady(true)
      }
    }
    fetchInfo()

    return () => { stopTracking() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [malId, epNum, user?.id])

  // ── Episode list ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (server === 'indo' && indoEpisodesRef.current.length > 0) {
      setEpisodeList(indoEpisodesRef.current
        .filter(ep => ep.url)
        .map(ep => ({ number: ep.episode, title: ep.title, locked: false }))
      )
    } else if (airedEpisodes > 0 && isFinite(airedEpisodes)) {
      setEpisodeList(Array.from({ length: airedEpisodes }, (_, i) => ({
        number: i + 1,
        title: `Episode ${i + 1}`,
        locked: false,
      })))
    } else {
      setEpisodeList(Array.from({ length: epNum }, (_, i) => ({
        number: i + 1,
        title: `Episode ${i + 1}`,
        locked: false,
      })))
    }
  }, [server, airedEpisodes, epNum, infoReady])

  // ── Load preferred server ──────────────────────────────────────────────────
  useEffect(() => {
    try {
      const pref = localStorage.getItem('preferred-server') as Server
      if (pref && ['sub', 'dub', 'indo'].includes(pref)) setServer(pref)
    } catch { /* silent */ }
  }, [])

  // ── Fullscreen change listener ─────────────────────────────────────────────
  useEffect(() => {
    function handleFsChange() { setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  // ── Visibility API ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        pauseSegment()
        setIsPlaying(false)
        save(usingPostMsgRef.current ? progressRef.current : calcWallProgress())
      } else {
        if (watchedMsRef.current > 0 || progressRef.current > 0) startSegment()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [malId, epNum])

  // ── postMessage ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      let data = e.data
      if (typeof data === 'string') { try { data = JSON.parse(data) } catch { return } }
      const event = data?.event ?? data?.type ?? data?.name

      if (typeof data?.currentTime === 'number' && typeof data?.duration === 'number' && data.duration > 0) {
        usingPostMsgRef.current = true
        currentTimeRef.current = data.currentTime
        durationMsRef.current = data.duration * 1000
        const pct = Math.round((data.currentTime / data.duration) * 100)
        if (pct >= 95) { save(100); stopTracking(); return }
        progressRef.current = pct
        return
      }

      if (event === 'pause') { pauseSegment(); setIsPlaying(false); return }
      if (event === 'play') { startSegment(); setIsPlaying(true); return }
      if (event === 'complete') { save(100); stopTracking(); return }
      if (event === 'error') { setMegaplayError(true); return }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Popup ad blocker ───────────────────────────────────────────────────────
  useEffect(() => {
    function onBlur() {
      if (isHoveringPlayer.current) setTimeout(() => window.focus(), 50)
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  useEffect(() => { setIsLoading(true); setMegaplayError(false) }, [iframeKey, server, epNum])

  useEffect(() => {
    if (server === 'indo' && indoSrc) {
      setIframeKey(k => k + 1)
      setIsLoading(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indoSrc])

  // ── Setup direct video player ──────────────────────────────────────────────
  useEffect(() => {
    if (server !== 'indo' || !directUrl) return
    const videoEl = videoRef.current
    if (!videoEl) return

    let cancelled = false
    const proxiedUrl = `/api/proxy/stream-indo?endpoint=proxy-video&url=${encodeURIComponent(directUrl)}&referer=${encodeURIComponent(indoReferer ?? indoSrc ?? directUrl)}`

    async function setupVideo() {
      if (!videoEl) return
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }

      const isHls = directUrl!.includes('.m3u8')
      const hasNativeHls = videoEl.canPlayType('application/vnd.apple.mpegurl') !== ''

      if (isHls && !hasNativeHls) {
        try {
          const { default: Hls } = await import('hls.js')
          if (cancelled) return
          if (Hls.isSupported()) {
            const hls = new Hls()
            hls.loadSource(proxiedUrl)
            hls.attachMedia(videoEl)

            // Kunci ke level bitrate tertinggi yang ada di manifest ini &
            // matiin ABR — jadi gak diam-diam turun kualitas pas koneksi
            // lemot. Mirror Indo kita rata-rata cuma 1 level per "quality"
            // (jadi ini biasanya no-op), tapi kalau ternyata manifest-nya
            // multi-bitrate, ini yang nge-lock ke yang paling tinggi.
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!hls.levels || hls.levels.length === 0) return
              let bestIdx = 0
              let bestHeight = 0
              hls.levels.forEach((lvl: { height?: number }, idx: number) => {
                const h = lvl.height ?? 0
                if (h >= bestHeight) { bestHeight = h; bestIdx = idx }
              })
              hls.currentLevel = bestIdx // angka selain -1 = matiin auto/ABR
            })

            hlsRef.current = hls
            return
          }
        } catch { }
      }
      videoEl.src = proxiedUrl
    }

    setupVideo()

    return () => {
      cancelled = true
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directUrl, server])

  function handleDirectVideoError() {
    setDirectUrl(null)
    // Source yang lagi aktif gak punya iframe fallback (kasus umum buat
    // NontonAnimeID) — daripada nampilin iframe kosong, coba resolve ulang.
    if (!indoSrc) fetchIndoSrc()
  }

  useEffect(() => {
    if (server === 'indo' && infoReady) fetchIndoSrc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server, malId, epNum, infoReady, quality])

  function handleIframeLoad() {
    // currentSrc (= indoSrc, URL iframe) bisa null walau stream-nya valid —
    // kejadian kalau source balikin directUrl tanpa iframe fallback sama
    // sekali (Sokuja, confirmed 29 Jun 2026). Guard ini dulu cuma ngecek
    // currentSrc, jadi loading overlay nyangkut selamanya buat source kayak
    // gitu walau <video>-nya udah beneran play.
    if (!currentSrc && !directUrl) return
    setIsLoading(false)
    save(Math.max(5, progressRef.current))
    startTracking()
  }

  function switchServer(s: Server) {
    if (s === server) return
    stopTracking()
    try { localStorage.setItem('preferred-server', s) } catch { /* silent */ }
    if (s !== 'indo') {
      setIndoSrc(null)
      setDirectUrl(null)
      setIndoError(null)
      setIndoSource('otakudesu')
      setIndoReferer(null)
      setIframeKey(k => k + 1)
    }
    setServer(s)
  }

  async function fetchIndoSrc(manualQuery?: string) {
    const mySeq = ++indoFetchSeqRef.current
    const isStale = () => mySeq !== indoFetchSeqRef.current

    setIndoLoading(true)
    setIndoError(null)
    setIndoNotice(null)
    setIndoSrc(null)
    setDirectUrl(null)
    setAvailableQualities([])
    setIndoSource('otakudesu')
    setIndoReferer(null)

    let iframe: string | null = null
    let direct: string | null = null
    let qualities: number[] = []
    let otakudesuOk = false
    let resolvedTitle = manualQuery || (animeInfoRef.current.title !== 'Unknown' ? animeInfoRef.current.title : '')

    try {
      // ── Jalur Otakudesu — logikanya sama persis kayak sebelumnya, cuma gak
      // langsung return/throw lagi di sini supaya bisa lanjut ke fallback
      // multi-source kalau ini gagal atau kualitasnya kurang dari 720p. ──
      if (!manualQuery && indoMalIdRef.current === malId && indoEpisodesRef.current.length > 0) {
        let epData = indoEpisodesRef.current.find(e => e.episode === epNum)

        if (!epData?.url) {
          const candidates = indoEpisodesRef.current.filter(e => e.url)
          if (candidates.length > 0) {
            epData = candidates.reduce((closest, e) =>
              Math.abs(e.episode - epNum) < Math.abs(closest.episode - epNum) ? e : closest
            )
            if (isStale()) return
            setIndoNotice(`Episode ${epNum} ga ada di Otakudesu — nampilin episode terdekat: Ep ${epData.episode}`)
          }
        }

        if (epData?.url) {
          for (let attempt = 0; attempt < 2 && !iframe; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 800))
            const streamRes = await fetch(`/api/proxy/stream-indo?endpoint=stream&url=${encodeURIComponent(epData.url)}&quality=${quality}`)
            const streamJson = await streamRes.json()
            iframe = streamJson.data?.iframe ?? null
            direct = streamJson.data?.directUrl ?? null
            qualities = streamJson.data?.availableQualities ?? []
            if (isStale()) return
          }
          if (iframe) {
            setIndoEpTitle(epData.title ?? null)
            otakudesuOk = true
          }
        }
      } else {
        const searchParams = new URLSearchParams({ endpoint: 'auto', episode: String(epNum), quality: String(quality) })
        if (manualQuery) {
          searchParams.set('title', manualQuery)
        } else {
          searchParams.set('malId', malId)
          if (animeInfoRef.current.title && animeInfoRef.current.title !== 'Unknown') {
            searchParams.set('title', animeInfoRef.current.title)
          }
        }
        const altTitles = animeInfoRef.current.altTitles
        if (altTitles && altTitles.length > 0) searchParams.set('altTitles', altTitles.join(','))

        let json: any = null
        let otakudesuSearchFailed = false
        for (let attempt = 0; attempt < 2 && !iframe; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 800))
          const res = await fetch(`/api/proxy/stream-indo?${searchParams}`)
          json = await res.json()
          if (isStale()) return
          if (!res.ok || json.error) {
            otakudesuSearchFailed = true
            break
          }
          iframe = json.data?.currentEpisode?.iframe ?? null
          direct = json.data?.currentEpisode?.directUrl ?? null
          qualities = json.data?.currentEpisode?.availableQualities ?? []
        }
        if (isStale()) return

        if (!otakudesuSearchFailed && json?.data) {
          indoEpisodesRef.current = json.data?.episodes ?? []
          indoMalIdRef.current = malId
          resolvedTitle = json.data?.anime?.title || resolvedTitle

          const meta = json.data?.meta
          if (meta && meta.isExactMatch === false) {
            setIndoNotice(`Episode ${meta.episodeRequested} ga ada di Otakudesu — nampilin episode terdekat: Ep ${meta.episodeFound}`)
          }
          if (iframe) {
            setIndoEpTitle(json.data?.currentEpisode?.title ?? null)
            otakudesuOk = true
          }
        }
      }

      // ── Fallback multi-source ──
      // Dicoba kalau Otakudesu gagal total, ATAU berhasil tapi kualitas
      // terbaiknya masih di bawah 720p. Kalau Otakudesu udah 720p+, langsung
      // dipakai tanpa nambah request lagi — biar tetep cepet di kasus normal.
      const otakudesuBest = qualities.length > 0 ? Math.max(...qualities) : 0
      if (resolvedTitle && (!otakudesuOk || otakudesuBest < 720)) {
        try {
          const msParams = new URLSearchParams({ title: resolvedTitle, episode: String(epNum), quality: String(quality) })
          const msRes = await fetch(`/api/proxy/stream-indo?endpoint=multi-stream&${msParams}`)
          const msJson = await msRes.json()
          if (isStale()) return

          if (!msJson.error && (msJson.data?.directUrl || msJson.data?.iframe)) {
            const msQualities: number[] = msJson.data?.availableQualities ?? []
            const msBest = msQualities.length > 0 ? Math.max(...msQualities) : 0

            // Pakai hasil multi-source kalau Otakudesu beneran gak ada apa-apa,
            // ATAU kalau multi-source dapet kualitas yang lebih bagus.
            if (!otakudesuOk || msBest > otakudesuBest) {
              iframe = msJson.data.iframe ?? null
              direct = msJson.data.directUrl ?? null
              qualities = msQualities
              setIndoSource(msJson.data.source ?? 'otakudesu')
              setIndoReferer(msJson.data.episodeUrl ?? null)
            }
          }
        } catch { /* kalau ini gagal, hasil Otakudesu (kalau ada) tetap dipakai */ }
      }

      if (!iframe && !direct) {
        if (!manualQuery) setIndoManual(animeInfoRef.current.title)
        throw new Error('Link stream tidak ditemukan di semua source — coba refresh atau edit judul di bawah')
      }

      setDirectUrl(direct)
      setIndoSrc(iframe)
      setAvailableQualities(qualities)
    } catch (e: any) {
      if (isStale()) return
      setIndoError(e.message)
    } finally {
      if (!isStale()) setIndoLoading(false)
    }
  }

  // ── Download click handler ────────────────────────────────────────────────
  async function handleDownloadClick() {
    setShowDownloadModal(true)
    setDownloadLoading(true)
    setDownloadError(null)
    setDownloadGroups(null)

    let episodeUrl = ''
    if (server === 'indo' && indoEpisodesRef.current.length > 0) {
      const epData = indoEpisodesRef.current.find(e => e.episode === epNum)
      if (epData?.url) {
        episodeUrl = epData.url
      }
    }

    if (!episodeUrl) {
      try {
        const searchParams = new URLSearchParams({
          endpoint: 'auto',
          episode: String(epNum),
          title: animeDetails?.title || animeInfoRef.current.title,
        })
        if (animeInfoRef.current.altTitles && animeInfoRef.current.altTitles.length > 0) {
          searchParams.set('altTitles', animeInfoRef.current.altTitles.join(','))
        }
        const res = await fetch(`/api/proxy/stream-indo?${searchParams}`)
        const json = await res.json()
        if (json.data?.currentEpisode?.url) {
          episodeUrl = json.data.currentEpisode.url
        }
      } catch (err) { }
    }

    if (!episodeUrl) {
      setDownloadError('Gagal mencari episode ini di server Indo untuk link download.')
      setDownloadLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/proxy/stream-indo?endpoint=download&url=${encodeURIComponent(episodeUrl)}`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      setDownloadGroups(json.data || [])
    } catch (err: any) {
      setDownloadError(err.message || 'Gagal memuat link download.')
    } finally {
      setDownloadLoading(false)
    }
  }

  const servers: { id: Server; label: string; activeClass: string; dotColor: string }[] = [
    {
      id: 'sub',
      label: 'SUB',
      activeClass: 'bg-gradient-to-r from-sky-600 to-blue-600 text-white border-transparent shadow-md shadow-sky-500/25',
      dotColor: 'bg-sky-400',
    },
    {
      id: 'dub',
      label: 'DUB',
      activeClass: 'bg-gradient-to-r from-green-600 to-lime-600 text-white border-transparent shadow-md shadow-green-500/25',
      dotColor: 'bg-lime-400',
    },
    {
      id: 'indo',
      label: 'SUB INDO 🇮🇩',
      activeClass: 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-transparent shadow-md shadow-emerald-500/25',
      dotColor: 'bg-emerald-400',
    },
  ]

  return (
    <div className="min-h-screen bg-[#07070f] text-zinc-100 flex flex-col font-sans">
      <header className="sticky top-0 z-50 bg-[#07070f]/95 backdrop-blur shadow-lg shadow-black/40">
        <div className="h-0.5 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-orange-500" />
        <div className="flex items-center justify-between px-4 md:px-8 py-3.5">
          <Link
            href={`/anime/${malId}`}
            className="flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to List
          </Link>

          <span className="text-sm font-extrabold text-zinc-300">
            Episode{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              {epNum}
            </span>
            {airedEpisodes > 0 && isFinite(airedEpisodes) && (
              <span className="text-zinc-500 font-medium"> / {airedEpisodes}</span>
            )}
          </span>

          <button
            onClick={() => {
              stopTracking()
              if (server === 'indo') {
                fetchIndoSrc()
              } else {
                setIframeKey(k => k + 1)
              }
            }}
            title="Refresh player"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 border border-white/5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto px-0 md:px-6 py-5 flex flex-col gap-5">
        {/* ── 1. Video Player ── */}
        <div
          ref={playerContainerRef}
          className="group relative w-full aspect-video md:rounded-2xl overflow-hidden bg-[#0a0a12]"
          style={{
            boxShadow:
              '0 0 0 1px rgba(16,185,129,0.12), 0 25px 60px -15px rgba(0,0,0,0.95), 0 0 100px -30px rgba(16,185,129,0.08)',
          }}
          onMouseEnter={() => { isHoveringPlayer.current = true }}
          onMouseLeave={() => { isHoveringPlayer.current = false }}
        >
          {(isLoading || indoLoading) && (
            <LoadingOverlay label={indoLoading ? 'Mencari sub indo…' : 'Memuat player…'} />
          )}

          {server === 'indo' && directUrl ? (
            <video
              key={directUrl}
              ref={videoRef}
              onLoadedData={handleIframeLoad}
              onError={handleDirectVideoError}
              className="absolute inset-0 w-full h-full"
              controls
              autoPlay
              playsInline
            />
          ) : (
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={currentSrc ?? undefined}
              onLoad={handleIframeLoad}
              title={`${animeDetails?.title || 'Anime'} - Episode ${epNum}`}
              className="absolute inset-0 w-full h-full"
              allowFullScreen
              allow={
                server === 'indo'
                  ? 'autoplay; encrypted-media; fullscreen; picture-in-picture'
                  : 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write'
              }
              // Sandbox cuma buat fallback Indo (pas extract direct-video
              // gagal & jatuh ke iframe host asli) — blokir window.open()
              // popup & redirect paksa, dua sumber iklan paling ganggu.
              // Sub/Dub (megaplay) dibiarin tanpa sandbox karena udah
              // pernah dicoba & malah bikin player-nya gagal load.
              sandbox={server === 'indo' ? 'allow-scripts allow-same-origin allow-forms' : undefined}
            />
          )}

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh'}
            aria-label={isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh'}
            className="absolute bottom-3 right-3 z-10 p-2 rounded-xl bg-black/60 backdrop-blur-sm border border-white/10 text-zinc-300 hover:text-white hover:bg-black/80 transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <Maximize className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* ── 2. Episode Navigation ── */}
        {(canGoPrev || canGoNext) && (
          <div className="flex items-center justify-between gap-3 px-4 md:px-0">
            {prevHref ? (
              <Link
                href={prevHref}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95
                  bg-gradient-to-r from-emerald-600/10 to-transparent border-emerald-500/20 text-emerald-300
                  hover:from-emerald-600/20 hover:border-emerald-400/40 hover:text-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                Ep {epNum - 1}
              </Link>
            ) : <div />}

            {nextHref ? (
              <Link
                href={nextHref}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 ml-auto
                  bg-gradient-to-l from-teal-600/10 to-transparent border-teal-500/20 text-teal-300
                  hover:from-teal-600/20 hover:border-teal-400/40 hover:text-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Ep {epNum + 1}
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            ) : <div />}
          </div>
        )}

        {/* ── 3. Server Selector ── */}
        <div className="bg-[#0d0d1a] border border-white/5 p-4 rounded-2xl flex flex-col gap-3 mx-4 md:mx-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-4 rounded-full bg-gradient-to-b from-emerald-500 to-teal-500" />
              <span className="text-[10px] font-extrabold text-zinc-300 uppercase tracking-widest">Pilih Server</span>
            </div>
            {server === 'indo' && indoEpTitle && (
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] text-emerald-400/80 font-medium truncate max-w-[180px]">
                  {indoEpTitle}
                </span>
                {indoSource !== 'otakudesu' && (
                  <span className="text-[9px] font-bold text-teal-300 bg-teal-500/10 border border-teal-500/20 px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
                    via {SOURCE_LABELS[indoSource] ?? indoSource}
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {servers.map(({ id, label, activeClass, dotColor }) => (
              <button
                key={id}
                onClick={() => switchServer(id)}
                className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all duration-200 cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none
                  ${server === id
                    ? activeClass
                    : 'bg-[#0a0a12] text-zinc-400 border-white/5 hover:text-white hover:border-white/10'
                  }`}
              >
                {server === id && (
                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`} aria-hidden="true" />
                )}
                {label}
              </button>
            ))}
          </div>

          {server === 'indo' && (
            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/5">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest pl-0.5">Kualitas</span>
              <div className="relative">
                <button
                  onClick={() => setShowQualityMenu(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold border bg-emerald-600/20 text-emerald-300 border-emerald-500/40 transition-all cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {quality}p
                  <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showQualityMenu ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>

                {showQualityMenu && (
                  <>
                    {/* Backdrop transparan — klik di luar buat nutup menu */}
                    <div className="fixed inset-0 z-40" onClick={() => setShowQualityMenu(false)} />
                    <div className="absolute left-0 bottom-full mb-2 z-50 w-36 bg-[#13131f] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
                      {([1080, 720, 480, 360] as const).map(q => {
                        const known = availableQualities.length > 0
                        const isAvailable = !known || availableQualities.includes(q)
                        const isBest = known && q === Math.max(...availableQualities)
                        return (
                          <button
                            key={q}
                            onClick={() => {
                              const next = q as 1080 | 720 | 480 | 360
                              setQuality(next)
                              saveQuality(next)
                              setShowQualityMenu(false)
                            }}
                            title={known && !isAvailable ? 'Gak tersedia buat episode ini — bakal jatuh ke kualitas terbaik yang ada' : undefined}
                            className={`relative w-full flex items-center justify-between gap-2 px-3.5 py-2 text-[11px] font-bold transition-colors cursor-pointer
                              ${quality === q
                                ? 'bg-emerald-600/20 text-emerald-300'
                                : isAvailable
                                  ? 'text-zinc-300 hover:bg-white/5'
                                  : 'text-zinc-600 opacity-50'
                              }`}
                          >
                            <span className="flex items-center gap-1.5">
                              {q}p
                              {isBest && (
                                <span className="w-1.5 h-1.5 rounded-full bg-teal-400" aria-label="Kualitas terbaik tersedia" />
                              )}
                            </span>
                            {quality === q && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {server === 'indo' && availableQualities.length > 0 && !availableQualities.includes(quality) && (
            <p className="text-[10px] text-amber-400/90 font-medium bg-amber-950/20 border border-amber-700/20 px-3 py-2 rounded-xl">
              ⚠️ {quality}p gak tersedia di {SOURCE_LABELS[indoSource] ?? indoSource} buat episode ini — nampilin kualitas terbaik yang ada ({Math.max(...availableQualities)}p).
            </p>
          )}

          {server === 'indo' && availableQualities.length > 0 && Math.max(...availableQualities) <= 480 && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[10px] text-amber-400/90 font-medium bg-amber-950/20 border border-amber-700/20 px-3 py-2 rounded-xl flex-1">
                ⚠️ Semua source Indo cuma punya {Math.max(...availableQualities)}p buat episode ini — coba server SUB untuk kualitas lebih tinggi.
              </p>
              <button
                onClick={() => switchServer('sub')}
                className="h-8 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[11px] font-bold hover:from-emerald-500 hover:to-teal-500 transition-all cursor-pointer active:scale-95 shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Coba SUB
              </button>
            </div>
          )}

          {server === 'indo' && indoNotice && !indoError && (
            <p className="text-[10px] text-amber-400/90 font-medium bg-amber-950/20 border border-amber-700/20 px-3 py-2 rounded-xl">
              ⚠️ {indoNotice}
            </p>
          )}
          {server === 'indo' && indoError && (
            <div className="flex flex-col gap-2 mt-1">
              <p className="text-[10px] text-red-400 bg-red-950/20 border border-red-800/20 px-3 py-2 rounded-xl">
                ❌ {indoError}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Edit judul anime lalu Enter (coba nama versi Indo)…"
                  value={indoManual}
                  onChange={e => setIndoManual(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && indoManual.trim()) fetchIndoSrc(indoManual.trim())
                  }}
                  className="flex-1 h-8 px-3 rounded-xl bg-[#07070f] border border-white/5 text-[11px] text-white placeholder-zinc-650 outline-none focus:border-emerald-500/40 transition-colors"
                />
                <button
                  onClick={() => { if (indoManual.trim()) fetchIndoSrc(indoManual.trim()) }}
                  disabled={!indoManual.trim()}
                  className="h-8 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[11px] font-bold hover:from-emerald-500 hover:to-teal-500 disabled:opacity-35 transition-all cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  Cari
                </button>
              </div>
            </div>
          )}
          {server !== 'indo' && megaplayError && (
            <div className="flex flex-col gap-2 mt-1">
              <p className="text-[10px] text-red-400 bg-red-950/20 border border-red-800/20 px-3 py-2 rounded-xl">
                ❌ Episode ini belum tersedia di server {server === 'sub' ? 'SUB' : 'DUB'} — coba server lain.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => switchServer(server === 'sub' ? 'dub' : 'sub')}
                  className="h-8 px-3.5 rounded-xl bg-[#0a0a12] border border-white/10 text-zinc-300 text-[11px] font-bold hover:text-white hover:border-white/20 transition-all cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  Coba {server === 'sub' ? 'DUB' : 'SUB'}
                </button>
                <button
                  onClick={() => switchServer('indo')}
                  className="h-8 px-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[11px] font-bold hover:from-emerald-500 hover:to-teal-500 transition-all cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  Coba INDO
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 4. Action Buttons ── */}
        <div data-lenis-prevent className="flex items-center gap-2 overflow-x-auto scrollbar-hide px-4 md:px-0 pb-0.5">
          <button
            onClick={() => {
              const newLiked = !liked
              const newDisliked = newLiked ? false : disliked
              setLiked(newLiked)
              setDisliked(newDisliked)
              setLikeCount(likeBaseRef.current + (newLiked ? 1 : 0))
              setDislikeCount(dislikeBaseRef.current + (newDisliked ? 1 : 0))
              saveReaction(malId, epNum, { liked: newLiked, disliked: newDisliked })
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all border shrink-0 cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none
              ${liked
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 border-transparent text-white shadow-md shadow-emerald-500/25'
                : 'bg-[#0d0d1a] border-white/5 text-zinc-300 hover:border-white/10 hover:text-white'
              }`}
          >
            <ThumbsUp className={`w-3.5 h-3.5 transition-transform ${liked ? 'fill-current scale-110' : ''}`} aria-hidden="true" />
            <span>{likeCount.toLocaleString('id-ID')}</span>
          </button>

          <button
            onClick={() => {
              const newDisliked = !disliked
              const newLiked = newDisliked ? false : liked
              setDisliked(newDisliked)
              setLiked(newLiked)
              setDislikeCount(dislikeBaseRef.current + (newDisliked ? 1 : 0))
              setLikeCount(likeBaseRef.current + (newLiked ? 1 : 0))
              saveReaction(malId, epNum, { liked: newLiked, disliked: newDisliked })
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all border shrink-0 cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none
              ${disliked
                ? 'bg-[#1a1a2a] border-zinc-650 text-white'
                : 'bg-[#0d0d1a] border-white/5 text-zinc-300 hover:border-white/10 hover:text-white'
              }`}
          >
            <ThumbsDown className={`w-3.5 h-3.5 ${disliked ? 'fill-current' : ''}`} aria-hidden="true" />
            <span>{dislikeCount.toLocaleString('id-ID')}</span>
          </button>

          <div className="w-px h-5 bg-white/5 shrink-0 mx-0.5" />

          {/* Download */}
          <button
            onClick={handleDownloadClick}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold bg-[#0d0d1a] border border-white/5 text-zinc-300 hover:border-sky-500/30 hover:text-sky-400 hover:bg-sky-950/20 transition-all shrink-0 cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download</span>
          </button>

          {/* Share */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href)
              toast('Link disalin ke clipboard!', 'success')
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold bg-[#0d0d1a] border border-white/5 text-zinc-300 hover:border-blue-500/30 hover:text-blue-400 hover:bg-blue-950/20 transition-all shrink-0 cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Share</span>
          </button>
        </div>

        {/* ── 5. Anime Info Card ── */}
        <div className="rounded-2xl overflow-hidden border border-white/5 bg-[#0d0d1a] mx-4 md:mx-0">
          <div className="flex items-start gap-3 p-4">
            {animeDetails?.poster ? (
              <NextImage
                src={animeDetails.poster}
                alt="Poster"
                width={56}
                height={80}
                className="w-14 h-20 rounded-xl object-cover border border-white/5 flex-shrink-0 shadow-lg shadow-black/50"
              />
            ) : (
              <div className="w-14 h-20 rounded-xl flex-shrink-0 bg-gradient-to-br from-zinc-800 to-zinc-900 border border-white/5 flex items-center justify-center">
                <svg className="w-5 h-5 text-zinc-650" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
              </div>
            )}
            <div className="flex-1 flex flex-col gap-1.5 min-w-0 pt-0.5">
              <h2 className="text-sm font-black text-white leading-tight line-clamp-2">
                {animeDetails?.title || 'Unknown'}
              </h2>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-700/30 px-2 py-0.5 rounded-full">
                  Ep {epNum}
                </span>
                <span className="text-[10px] text-zinc-500 font-semibold">{animeDetails?.aired || ''}</span>
              </div>
              <p className={`text-[11px] text-zinc-400 leading-relaxed mt-0.5 ${isDescExpanded ? '' : 'line-clamp-3'}`}>
                {animeDetails?.synopsis || 'Tidak ada deskripsi.'}
              </p>
              <button
                onClick={() => setIsDescExpanded(!isDescExpanded)}
                className="text-emerald-400 hover:text-emerald-300 transition-colors font-bold text-[10px] uppercase tracking-wider self-start flex items-center gap-0.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <span>{isDescExpanded ? 'Sembunyikan' : 'Selengkapnya'}</span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isDescExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="border-t border-white/5 px-4 py-2.5 flex items-center justify-end">
            <button className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-zinc-550 hover:text-amber-400 hover:bg-amber-950/30 border border-transparent hover:border-amber-800/30 transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
              <Flag className="w-3 h-3" aria-hidden="true" />
              <span>Laporkan</span>
            </button>
          </div>
        </div>

        {/* ── 7. Episode List ── */}
        <div className="flex flex-col gap-3 bg-[#0d0d1a] border border-white/5 rounded-2xl p-4 mx-4 md:mx-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-4 rounded-full bg-gradient-to-b from-emerald-500 to-teal-500" />
              <h3 className="text-xs font-black text-white tracking-wider uppercase">Episode List</h3>
            </div>
            {airedEpisodes > 0 && isFinite(airedEpisodes) ? (
              <span className="text-[10px] font-semibold text-zinc-400 bg-white/5 border border-white/5 px-2.5 py-0.5 rounded-full">
                {airedEpisodes} Ep Tayang
              </span>
            ) : !infoReady ? (
              <span className="text-[10px] text-zinc-650 animate-pulse font-semibold">Memuat…</span>
            ) : null}
          </div>

          {episodeList.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-zinc-650 text-xs font-semibold">
              <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> Memuat episode…
            </div>
          ) : (
            <div data-lenis-prevent className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-1 -mx-1 px-1">
              {episodeList.map((ep) => {
                const isCurrent = ep.number === epNum
                const isEpWatched = watchedEpNumbers.includes(ep.number)

                return (
                  <Link
                    key={`ep-box-${ep.number}`}
                    href={`/watch/${malId}/${ep.number}`}
                    title={`Episode ${ep.number}`}
                    className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-xs transition-all hover:scale-105 active:scale-95
                      ${isCurrent
                        ? 'bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/20'
                        : isEpWatched
                          ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/40 hover:border-emerald-500/60 hover:text-emerald-300'
                          : 'bg-[#0a0a12] text-zinc-550 border border-white/5 hover:text-white hover:border-white/10 hover:bg-white/5'
                      }`}
                  >
                    {ep.number}
                  </Link>
                )
              })}
            </div>
          )}

          <div className="flex items-center gap-4 text-[10px] text-zinc-650 font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-gradient-to-br from-emerald-600 to-teal-600 inline-block" />
              Sedang ditonton
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-emerald-950/50 border border-emerald-800/40 inline-block" />
              Sudah ditonton
            </span>
          </div>
        </div>

        {/* ── 8. Community Notice ── */}
        <div className="flex items-center gap-2 py-2.5 px-3.5 rounded-xl bg-[#0d0d1a] border border-white/5 mx-4 md:mx-0">
          <span className="text-base select-none">💬</span>
          <p className="text-[11px] text-zinc-550 leading-relaxed font-semibold">
            Berkomentarlah dengan sopan dan ikuti{' '}
            <Link href="/rules" className="text-emerald-400 hover:text-emerald-300 font-bold transition-colors">
              aturan komunitas
            </Link>{' '}
            kami.
          </p>
        </div>

        {/* ── 9. Comments ── */}
        <div className="border-t border-white/5 pt-3.5 mx-4 md:mx-0" />
        <div className="mx-4 md:mx-0">
          <CommentSection malId={malId} epNum={epNum} />
        </div>
      </main>

      {/* ── 10. Download Modal ── */}
      {showDownloadModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md transition-opacity duration-300">
          <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-3 shrink-0">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <Download className="w-5 h-5 text-emerald-400 animate-bounce" />
                <span>Download Episode {epNum}</span>
              </h3>
              <button
                onClick={() => setShowDownloadModal(false)}
                className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div data-lenis-prevent className="overflow-y-auto pr-1 flex flex-col gap-3 my-1">
              {downloadLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                  <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Mencari link download...</p>
                </div>
              )}

              {downloadError && (
                <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/20 text-center flex flex-col gap-2">
                  <p className="text-xs text-red-400 font-semibold">{downloadError}</p>
                  <button
                    onClick={handleDownloadClick}
                    className="self-center px-4 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-xs font-bold text-red-300 transition-colors"
                  >
                    Coba Lagi
                  </button>
                </div>
              )}

              {!downloadLoading && !downloadError && downloadGroups && (
                downloadGroups.length === 0 ? (
                  <p className="text-center py-8 text-xs text-zinc-500">Tidak ada link download yang tersedia.</p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {downloadGroups.map((group, idx) => (
                      <div key={idx} className="p-4 rounded-2xl bg-[#0d0d1a] border border-white/5 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-white uppercase tracking-wider">
                            {group.format} - {group.quality}
                          </span>
                          {group.sizeLabel && (
                            <span className="text-[10px] font-bold text-zinc-550 bg-white/5 px-2 py-0.5 rounded">
                              {group.sizeLabel}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {group.hosts.map((host, hIdx) => (
                            <a
                              key={hIdx}
                              href={host.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center px-3 py-2 rounded-xl bg-[#07070f] hover:bg-emerald-950/20 border border-white/5 hover:border-emerald-500/30 text-center text-xs font-bold text-zinc-400 hover:text-emerald-300 transition-all active:scale-95"
                            >
                              {host.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Footer */}
            <div className="text-[10px] text-zinc-500 leading-relaxed bg-[#0d0d1a] p-3 rounded-2xl border border-white/5 shrink-0">
              ⚠️ Link download disediakan oleh pihak ketiga. Beberapa link mungkin memiliki iklan pop-up atau memerlukan bypass. Kami menyarankan menggunakan ad-blocker.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}