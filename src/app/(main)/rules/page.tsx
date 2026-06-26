import type { Metadata } from "next";
import Link from "next/link";
import {
  Shield,
  AlertTriangle,
  Eye,
  Heart,
  Ban,
  CheckCircle,
  Info,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Rules & Guidelines — AnimeSya",
  description:
    "Baca aturan dan pedoman penggunaan platform AnimeSya agar pengalaman menonton kamu tetap nyaman dan aman.",
};

const rules = [
  {
    icon: Eye,
    color: "text-accent",
    bg: "bg-accent/10",
    title: "Konten yang Tersedia",
    items: [
      "Semua konten anime bersumber dari layanan pihak ketiga yang tersedia secara publik.",
      "AnimeSya tidak menyimpan file video di server kami sendiri.",
      "Konten dewasa (18+) diblokir dan tidak tersedia di platform ini.",
      "Ketersediaan episode bergantung pada sumber streaming yang sedang aktif.",
    ],
  },
  {
    icon: CheckCircle,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    title: "Penggunaan yang Diperbolehkan",
    items: [
      "Menonton anime untuk keperluan pribadi dan non-komersial.",
      "Membuat watchlist dan menyimpan riwayat tontonanmu.",
      "Berbagi link episode dengan teman selama tidak untuk tujuan komersial.",
      "Menggunakan fitur pencarian untuk menemukan anime favoritmu.",
    ],
  },
  {
    icon: Ban,
    color: "text-red-400",
    bg: "bg-red-400/10",
    title: "Yang Tidak Diperbolehkan",
    items: [
      "Menggunakan bot atau scraper untuk mengambil data dari platform ini.",
      "Menjual akses atau konten yang didapat dari AnimeSya untuk keperluan komersial.",
      "Mencoba menembus sistem keamanan atau bypass proteksi konten.",
      "Menyebarkan konten dari platform ini dengan mengklaim sebagai milik sendiri.",
    ],
  },
  {
    icon: Shield,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    title: "Privasi & Akun",
    items: [
      "Data akunmu (watchlist, history) disimpan secara lokal di browser.",
      "Kami tidak mengumpulkan data pribadi yang sensitif.",
      "Kamu bisa menghapus data akun kapan saja dengan logout.",
      "Jaga kerahasiaan akun dan jangan bagikan ke orang lain.",
    ],
  },
  {
    icon: Heart,
    color: "text-pink-400",
    bg: "bg-pink-400/10",
    title: "Dukung Industri Anime",
    items: [
      "Jika kamu menikmati sebuah anime, pertimbangkan untuk membeli merchandise resminya.",
      "Dukung kreator dengan menonton di platform resmi jika tersedia di negaramu.",
      "Rekomendasikan anime bagus ke teman-temanmu untuk membantu industri berkembang.",
      "Berikan rating dan ulasan untuk membantu sesama penggemar menemukan anime yang tepat.",
    ],
  },
  {
    icon: AlertTriangle,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    title: "Disclaimer",
    items: [
      "AnimeSya adalah platform aggregator fan-made dan tidak berafiliasi dengan studio anime manapun.",
      "Kami tidak bertanggung jawab atas konten dari sumber pihak ketiga.",
      "Ketersediaan konten dapat berubah sewaktu-waktu tanpa pemberitahuan.",
      "Penggunaan platform ini sepenuhnya menjadi tanggung jawab pengguna.",
    ],
  },
];

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-zinc-950 pt-24 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-accent/10 border border-accent/20 rounded-full px-4 py-1.5 text-sm text-accent font-medium mb-4">
            <Info className="w-4 h-4" />
            Pedoman Platform
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-zinc-100 mb-3">
            Rules &amp; Guidelines
          </h1>
          <p className="text-zinc-400 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
            Harap baca dan pahami aturan berikut sebelum menggunakan AnimeSya.
            Dengan menggunakan platform ini, kamu dianggap telah menyetujui
            semua ketentuan yang berlaku.
          </p>
        </div>

        {/* Rules Cards */}
        <div className="flex flex-col gap-6">
          {rules.map((section, idx) => {
            const Icon = section.icon;
            return (
              <div
                key={idx}
                className="rounded-2xl bg-zinc-900/60 border border-zinc-800/60 p-6 backdrop-blur-sm"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${section.bg}`}
                  >
                    <Icon className={`w-5 h-5 ${section.color}`} />
                  </span>
                  <h2 className="text-base font-bold text-zinc-100">
                    {section.title}
                  </h2>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {section.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 mt-2 flex-shrink-0" />
                      <span className="text-sm text-zinc-400 leading-relaxed">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        <div className="mt-10 text-center">
          <p className="text-xs text-zinc-600 mb-4">
            Terakhir diperbarui: Juni 2025 &bull; Versi 1.0
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent/90 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    </div>
  );
}
