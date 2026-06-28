import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { animeApi } from '@/lib/anime-api'
import DetailClient from './DetailClient'

// ISR: halaman di-cache dan diperbarui otomatis setiap 1 jam di background
// Tanpa ini, setiap kunjungan akan fetch ulang ke API Jikan
export const revalidate = 3600

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  try {
    const anime = await animeApi.detail(slug)
    const title = `${anime.title} — AnimeSya`
    const description = anime.synopsis
      ? `${anime.synopsis.slice(0, 155)}...`
      : `Tonton ${anime.title} subtitle Indonesia kualitas HD gratis di AnimeSya.`
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: anime.poster ? [anime.poster] : [],
      },
    }
  } catch {
    return {
      title: 'Anime Detail — AnimeSya',
      description: 'Detail informasi anime, trailer, dan daftar episode terlengkap di AnimeSya.',
    }
  }
}

export default async function AnimeDetailPage({ params }: Props) {
  const { slug } = await params

  let anime
  try {
    anime = await animeApi.detail(slug)
  } catch {
    notFound()
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
      <DetailClient anime={anime} />
    </Suspense>
  )
}
