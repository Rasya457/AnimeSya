'use client'

import { useState, useEffect, useMemo } from 'react'
import { db } from '@/lib/firebase'
import {
  collection, query, where, onSnapshot,
  addDoc, deleteDoc, doc, serverTimestamp,
  type Timestamp,
} from 'firebase/firestore'
import { useAuthStore } from '@/store/authStore'
import { useToast } from '@/components/ui/Toast'
import { Send, MessageCircle, Trash2, Loader2 } from 'lucide-react'

interface Comment {
  id: string
  parentId: string | null
  authorId: string
  authorName: string
  text: string
  createdAt: number
}

function getAvatarBgColor(name: string): string {
  const charCode = name.charCodeAt(0) || 0
  const colors = [
    'bg-emerald-600', 'bg-sky-600', 'bg-indigo-600', 'bg-violet-600',
    'bg-purple-600', 'bg-pink-600', 'bg-rose-600', 'bg-red-600',
    'bg-orange-600', 'bg-amber-600',
  ]
  return colors[charCode % colors.length]
}

export default function CommentSection({ malId, epNum }: { malId: string; epNum: number }) {
  const { user } = useAuthStore()
  const { toast } = useToast()
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
            createdAt: ts ? ts.toMillis() : Date.now(),
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
      toast('Gagal mengirim komentar', 'error')
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
    } catch (e: any) {
      toast('Gagal membalas komentar', 'error')
    } finally {
      setReplySubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteDoc(doc(db, 'comments', id))
      toast('Komentar dihapus', 'success')
    } catch { /* silent */ }
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
          isOwn ? 'bg-accent/5 border-accent/15' : 'bg-[#0f0f1a] border-white/5'
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
                <span className="text-[9px] font-bold text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Kamu</span>
              )}
              <span className="text-[10px] text-zinc-550 font-semibold">{formatDate(c.createdAt)}</span>
            </div>
            {isOwn && (
              <button
                onClick={() => handleDelete(c.id)}
                className="p-1.5 rounded-lg text-zinc-650 hover:text-red-400 hover:bg-red-950/40 transition-colors cursor-pointer flex-shrink-0"
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
              className="self-start text-[11px] font-bold text-zinc-500 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer mt-0.5"
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
                  className="w-full bg-[#07070f] border border-white/5 rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all resize-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleSubmitReply(c.id)}
                    disabled={!replyText.trim() || replySubmitting}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all text-zinc-950 text-[11px] font-bold cursor-pointer active:scale-95"
                  >
                    {replySubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
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
        <div className="w-6 h-6 rounded-lg bg-accent/15 border border-accent/20 flex items-center justify-center flex-shrink-0">
          <MessageCircle className="w-3.5 h-3.5 text-accent" />
        </div>
        <h3 className="text-sm font-extrabold text-white">
          {commentsLoading
            ? 'Memuat komentar...'
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
                ? 'bg-accent text-zinc-950 shadow-sm shadow-accent/20'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Top
          </button>
          <button
            onClick={() => setActiveTab('newest')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'newest'
                ? 'bg-accent text-zinc-950 shadow-sm shadow-accent/20'
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
              className="w-full bg-[#07070f] border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-650">{commentText.length}/500</span>
              <button
                onClick={handleSubmit}
                disabled={!commentText.trim() || submitting}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all text-zinc-950 text-xs font-bold cursor-pointer active:scale-95 shadow-md shadow-accent/10"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
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
            <div className="w-12 h-12 rounded-2xl bg-accent/5 border border-accent/10 flex items-center justify-center">
              <MessageCircle className="w-5 h-5 opacity-40 text-accent" />
            </div>
            <p className="text-xs font-medium">Jadilah yang pertama berkomentar!</p>
          </div>
        )}
        {sortedTopLevel.map(c => renderComment(c, false))}
      </div>
    </section>
  )
}
