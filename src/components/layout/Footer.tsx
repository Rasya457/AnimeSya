import React from "react";
import Link from "next/link";

export const Footer: React.FC = () => {
  return (
    <footer className="w-full bg-zinc-950 border-t border-zinc-900 py-10 px-6 md:px-12 mt-auto text-zinc-500 text-xs md:text-sm flex flex-col md:flex-row items-center justify-between gap-6">
      <div className="flex flex-col items-center md:items-start gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-tight bg-gradient-to-r from-accent to-emerald-400 bg-clip-text text-transparent">
            AnimeSya
          </span>
          <span className="w-1 h-1 rounded-full bg-accent" />
        </div>
        <p className="text-zinc-600 text-center md:text-left">
          © {new Date().getFullYear()} AnimeSya. Made for Anime fans worldwide.
        </p>
      </div>

      <div className="flex items-center gap-6 font-medium">
        <a href="https://discord.gg" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">
          Discord
        </a>
        <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">
          Twitter
        </a>
        <Link href="/browse" className="hover:text-zinc-300 transition-colors">
          Catalog
        </Link>
        <Link href="/watchlist" className="hover:text-zinc-300 transition-colors">
          Collections
        </Link>
      </div>
    </footer>
  );
};
export default Footer;
