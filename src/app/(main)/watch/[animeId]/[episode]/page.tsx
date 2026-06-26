import { notFound } from 'next/navigation'
import { animeApi } from '@/lib/anime-api'
import WatchClient from './WatchClient'

interface Props {
  params: Promise<{ animeId: string; episode: string }>
}

export async function generateMetadata({ params }: Props) {
  const { animeId, episode } = await params
  try {
    const anime = await animeApi.detail(animeId)
    const title = `Nonton ${anime.title} Episode ${episode} Subtitle Indonesia — AnimeSya`
    const description = anime.synopsis
      ? `Tonton ${anime.title} Episode ${episode} Subtitle Indonesia gratis dengan kualitas HD di AnimeSya. ${anime.synopsis.slice(0, 150)}...`
      : `Tonton ${anime.title} Episode ${episode} Subtitle Indonesia gratis dengan kualitas HD di AnimeSya.`
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
      title: `Nonton Episode ${episode} — AnimeSya`,
      description: `Nonton anime subtitle Indonesia online gratis kualitas HD di AnimeSya.`,
    }
  }
}

export default async function WatchPage({ params }: Props) {
  // We can await params to validate it exists, but page itself can render WatchClient
  const { animeId } = await params
  try {
    // Just verifying it exists, otherwise trigger notFound
    await animeApi.detail(animeId)
  } catch {
    notFound()
  }

  return <WatchClient />
}