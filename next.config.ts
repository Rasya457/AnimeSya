import type { NextConfig } from 'next'
import path from 'path'

const securityHeaders = [
  // Cegah browser menebak MIME type
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Cegah clickjacking (iframe dari domain lain)
  { key: 'X-Frame-Options', value: 'DENY' },
  // Batasi info Referer ke same-origin saja
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Paksa HTTPS untuk 1 tahun
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Matikan sensor/mikrofon/lokasi
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Basic XSS protection
  { key: 'X-XSS-Protection', value: '1; mode=block' },
]

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Fix: workspace root agar Next.js tidak salah deteksi multi-lockfile
  // (warning "We detected multiple lockfiles" di Vercel).
  outputFileTracingRoot: path.join(__dirname, '../'),

  // Hapus header X-Powered-By supaya gak expose tech stack
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Security headers ke semua route
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Static assets — cache aggressive: 1 tahun (immutable)
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Image optimization cache 7 hari
        source: '/_next/image/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
        ],
      },
    ]
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.myanimelist.net' },
      { protocol: 'https', hostname: 'img.myanimelist.net' },
      { protocol: 'https', hostname: 'otakudesu.blog' },
      { protocol: 'https', hostname: 'otakudesu.fit' },
      { protocol: 'https', hostname: 'otakudesu.cloud' },
      { protocol: 'https', hostname: 'otakudesu.best' },
      { protocol: 'https', hostname: 'otakudesu.care' },
      { protocol: 'https', hostname: 'otakudesu.lol' },
      { protocol: 'https', hostname: '*.kuramanime.pro' },
      { protocol: 'https', hostname: 'kuramanime.pro' },
      { protocol: 'https', hostname: '*.wp.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 's4.anilist.co' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      // Sokuja CDN
      { protocol: 'https', hostname: 'gbr.sokuja.uk' },
      { protocol: 'https', hostname: '*.sokuja.uk' },
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    // 30 hari — poster anime jarang berubah, cache agresif menghemat bandwidth
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  compress: true,

  // Fix Turbopack + Firebase service registry error
  transpilePackages: [
    'firebase',
    '@firebase/app',
    '@firebase/auth',
    '@firebase/firestore',
    '@firebase/storage',
    '@firebase/util',
  ],

  serverExternalPackages: [
    'firebase-admin',
    'cheerio',
    'undici',
    '@capacitor/android',
    '@capacitor/cli',
    '@capacitor/core',
  ],

  experimental: {
    optimizePackageImports: [
      'framer-motion',
      'lucide-react',
      'date-fns',
      'recharts',
      'firebase',
    ],
  },
}

export default nextConfig

