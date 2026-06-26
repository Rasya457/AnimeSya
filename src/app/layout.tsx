import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import SmoothScrollProvider from "@/components/layout/SmoothScrollProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AnimeSya — Nonton Anime Online",
  description:
    "Nonton anime terbaru sub indo, sub, dan dub dalam kualitas HD. Temukan ribuan judul dari genre Action, Romance, Fantasy, dan lainnya — semua di satu tempat.",
  keywords: ["anime", "streaming", "nonton anime", "anime online", "animesya", "sub indo"],
  openGraph: {
    title: "AnimeSya — Nonton Anime Online",
    description: "Temukan dan nonton anime favoritmu dalam kualitas terbaik.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // h-full sengaja DIHAPUS dari sini — Lenis butuh height: auto di
    // <html>/<body> buat ngukur tinggi konten dengan akurat (lihat required
    // CSS-nya Lenis). Sticky-footer effect tetep aman, udah dihandle
    // min-h-screen di MainLayout.tsx, jadi gak kehilangan apa-apa.
    <html lang="id" className={`${inter.variable} antialiased`}>
      <body className="flex flex-col bg-background text-foreground font-[var(--font-inter)]">
        <SmoothScrollProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </SmoothScrollProvider>
      </body>
    </html>
  );
}