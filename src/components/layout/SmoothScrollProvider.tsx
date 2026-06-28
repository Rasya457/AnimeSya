'use client'

import { ReactLenis } from 'lenis/react'
import { ReactNode, useEffect, useMemo, useState } from 'react'
// Catatan: CSS resmi Lenis udah di-include manual di globals.css project ini,
// jadi gak perlu import 'lenis/dist/lenis.css' lagi di sini (bakal duplikat).

interface SmoothScrollProviderProps {
  children: ReactNode
}

export default function SmoothScrollProvider({ children }: SmoothScrollProviderProps) {
  const [isTouchDevice, setIsTouchDevice] = useState(false)

  useEffect(() => {
    // Detect touch support (mobile/tablets/hybrid laptops)
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    setIsTouchDevice(touch)
  }, [])

  // Penting: options di-memo biar reference-nya stabil antar render. Kalau
  // object literal dibuat ulang tiap render (kayak sebelumnya, inline di
  // prop), Lenis bisa destroy + rebuild instance-nya berulang-ulang setiap
  // parent re-render — ini salah satu biang umum scroll jadi stutter/error.
  const lenisOptions = useMemo(
    () => ({
      // duration + easing dipakai sebagai pengganti lerp mentah — lebih
      // gampang dikontrol "berapa lama" scroll selesai, dan kurva ini
      // (1.001 - 2^-10t) ngasih efek decel ala-iOS yang kerasa snappy
      // tapi tetep mulus, bukan lambat kayak lerp rendah.
      duration: 0.8,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    }),
    []
  )

  if (isTouchDevice) {
    // Use native mobile touch inertial scrolling (bypasses Lenis CPU ticks)
    return <>{children}</>
  }

  return (
    <ReactLenis root options={lenisOptions}>
      {children}
    </ReactLenis>
  )
}