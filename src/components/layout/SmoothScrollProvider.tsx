import { ReactNode } from 'react'

// Lenis smooth scroll dihapus — terlalu berat (JS tick tiap frame) dan
// tidak signifikan manfaatnya vs native scroll yang sudah cukup smooth
// di browser modern. Native scroll juga lebih responsive di low-end device.
export default function SmoothScrollProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}