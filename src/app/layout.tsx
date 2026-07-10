import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Outfit } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AnimeSya — Nonton Anime Online",
  description:
    "Nonton anime terbaru sub indo, sub, dan dub dalam kualitas HD. Temukan ribuan judul dari genre Action, Romance, Fantasy, dan lainnya — semua di satu tempat.",
  keywords: ["anime", "streaming", "nonton anime", "anime online", "animesya", "sub indo"],
  manifest: "/manifest.json",
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
    <html lang="id" className={`${plusJakartaSans.variable} ${outfit.variable} antialiased h-full`}>
      <body className="flex flex-col bg-background text-foreground font-sans min-h-screen">
        <ToastProvider>
          {children}
        </ToastProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js');
                });
              }
            `
          }}
        />
      </body>
    </html>
  );
}