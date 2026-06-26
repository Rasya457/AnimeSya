"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Heart, History, User } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

export const BottomNav: React.FC = () => {
  const pathname = usePathname();
  const { isAuthenticated } = useAuthStore();

  const activeClass = (path: string) =>
    pathname === path ? "text-accent scale-110" : "text-zinc-500 hover:text-zinc-300";

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 z-40 glass-dark border-t border-zinc-800/80 flex items-center justify-around px-4 shadow-[0_-8px_30px_rgba(0,0,0,0.5)]">
      <Link href="/" className={`flex flex-col items-center justify-center gap-1 transition-all ${activeClass("/")}`}>
        <Home className="w-5 h-5" />
        <span className="text-[10px] font-semibold tracking-wide">Home</span>
      </Link>

      <Link href="/watchlist" className={`flex flex-col items-center justify-center gap-1 transition-all ${activeClass("/watchlist")}`}>
        <Heart className="w-5 h-5" />
        <span className="text-[10px] font-semibold tracking-wide">Watchlist</span>
      </Link>

      <Link href="/search" className={`flex flex-col items-center justify-center gap-1 transition-all ${activeClass("/search")}`}>
        <Search className="w-5 h-5" />
        <span className="text-[10px] font-semibold tracking-wide">Search</span>
      </Link>

      <Link href="/history" className={`flex flex-col items-center justify-center gap-1 transition-all ${activeClass("/history")}`}>
        <History className="w-5 h-5" />
        <span className="text-[10px] font-semibold tracking-wide">History</span>
      </Link>

      <Link 
        href={isAuthenticated ? "/profile" : "/login"} 
        className={`flex flex-col items-center justify-center gap-1 transition-all ${activeClass("/profile")}`}
      >
        <User className="w-5 h-5" />
        <span className="text-[10px] font-semibold tracking-wide">Profile</span>
      </Link>
    </div>
  );
};
export default BottomNav;