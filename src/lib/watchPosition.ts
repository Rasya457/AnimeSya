// ─── Posisi tonton dalam DETIK (bukan persen) ────────────────────────────────
// Dipakai bareng oleh WatchClient (yang nulis, tiap beberapa detik/pause/
// unmount) dan HomeClient (yang baca, buat progress bar ijo di "Terakhir
// Ditonton"). Disatuin di sini biar key & bentuk datanya gak pernah beda-beda
// antara dua tempat itu.

export interface WatchPositionData {
  seconds: number
  duration?: number
  savedAt: number
}

export function positionKey(malId: string, epNum: number) {
  return `watch-position:${malId}:${epNum}`
}

// Cuma detik-nya doang — dipakai WatchClient buat seek exact pas resume.
export function loadPosition(malId: string, epNum: number): number {
  try {
    const raw = localStorage.getItem(positionKey(malId, epNum))
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    return typeof parsed?.seconds === 'number' && parsed.seconds > 0 ? parsed.seconds : 0
  } catch {
    return 0
  }
}

// Data lengkap (detik + durasi kalau ada) — dipakai HomeClient buat itung
// persen progress bar yang akurat, bukan cuma tebak-tebakan dari watchedEpisodes.
export function loadPositionFull(malId: string, epNum: number): WatchPositionData | null {
  try {
    const raw = localStorage.getItem(positionKey(malId, epNum))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.seconds !== 'number' || parsed.seconds <= 0) return null
    return {
      seconds: parsed.seconds,
      duration: typeof parsed?.duration === 'number' && parsed.duration > 0 ? parsed.duration : undefined,
      savedAt: typeof parsed?.savedAt === 'number' ? parsed.savedAt : 0,
    }
  } catch {
    return null
  }
}

// Persen 0–100 dari posisi detik / durasi. null kalau datanya gak lengkap
// (belum pernah nonton episode ini di server 'indo', atau durasi belom
// sempet ke-capture) — caller harus fallback ke sumber lain (HistoryItem.progress dst).
export function loadPositionPercent(malId: string, epNum: number): number | null {
  const pos = loadPositionFull(malId, epNum)
  if (!pos || !pos.duration) return null
  const pct = Math.round((pos.seconds / pos.duration) * 100)
  return Math.min(100, Math.max(0, pct))
}

export function savePosition(malId: string, epNum: number, seconds: number, duration?: number) {
  // Skip kalau < 3 detik — biar gak nyimpen noise pas video baru mulai/lagi
  // re-seek, dan skip NaN/Infinity dari video yang belom ready.
  if (!Number.isFinite(seconds) || seconds < 3) return
  try {
    const payload: WatchPositionData = {
      seconds,
      savedAt: Date.now(),
      ...(Number.isFinite(duration) && (duration as number) > 0 ? { duration } : {}),
    }
    localStorage.setItem(positionKey(malId, epNum), JSON.stringify(payload))
  } catch { /* silent */ }
}