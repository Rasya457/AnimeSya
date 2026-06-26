import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Jikan / MyAnimeList CDN
      { protocol: 'https', hostname: 'cdn.myanimelist.net' },
      { protocol: 'https', hostname: 'img.myanimelist.net' },
      // semua domain otakudesu yang mungkin berubah
      { protocol: 'https', hostname: 'otakudesu.cloud' },
      { protocol: 'https', hostname: 'otakudesu.best' },
      { protocol: 'https', hostname: 'otakudesu.care' },
      { protocol: 'https', hostname: 'otakudesu.lol' },
      // kuramanime
      { protocol: 'https', hostname: '*.kuramanime.pro' },
      { protocol: 'https', hostname: 'kuramanime.pro' },
      // wordpress CDN yang biasa dipake
      { protocol: 'https', hostname: '*.wp.com' },
      // Unsplash (untuk avatar/placeholder)
      { protocol: 'https', hostname: 'images.unsplash.com' },
      // AniList CDN
      { protocol: 'https', hostname: 's4.anilist.co' },
    ],
  },
}

export default nextConfig