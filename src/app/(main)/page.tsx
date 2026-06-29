import { animeApi } from '@/lib/anime-api'
import HomeClient from './HomeClient'
import type { Metadata } from 'next'

// ISR: Halaman akan di-generate ulang di background maksimal setiap 5 menit
export const revalidate = 300

export const metadata: Metadata = {
  title: 'AnimeSya — Nonton Anime Online Subtitle Indonesia',
  description: 'Nonton anime terbaru sub indo, sub, dan dub dalam kualitas HD. Temukan ribuan judul dari genre Action, Romance, Fantasy, dan lainnya — semua di satu tempat.',
  keywords: ['anime', 'streaming', 'nonton anime', 'anime online', 'animesya', 'sub indo', 'otakudesu', 'jikan'],
  openGraph: {
    title: 'AnimeSya — Nonton Anime Online',
    description: 'Temukan dan nonton anime favoritmu dalam kualitas terbaik.',
    type: 'website',
  },
}

export default async function HomePage() {
  const { ongoing, completed } = await animeApi.home()

  return <HomeClient ongoing={ongoing} completed={completed} />
}