"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Search, User, LogOut, Heart, History, Settings, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Button } from "../ui/Button";
import { motion, AnimatePresence } from "framer-motion";

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, isAuthLoading, logout } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = () => setDropdownOpen(false);
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const activeClass = (path: string) =>
    pathname === path ? "text-accent font-semibold" : "text-zinc-400 hover:text-zinc-100";

  return (
    <header className="fixed top-0 left-0 right-0 h-20 z-40 glass-navbar flex items-center justify-between px-6 md:px-12">
      {/* Brand Logo */}
      <div className="flex items-center gap-10">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-xl md:text-2xl font-black tracking-tight bg-gradient-to-r from-accent to-emerald-400 bg-clip-text text-transparent group-hover:opacity-90 transition-opacity">
            AnimeSya
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          <Link href="/" className={activeClass("/")}>
            Home
          </Link>
          <Link href="/watchlist" className={activeClass("/watchlist")}>
            Watchlist
          </Link>
          <Link href="/history" className={activeClass("/history")}>
            History
          </Link>
        </nav>
      </div>

      {/* Center Search Input */}
      <form onSubmit={handleSearchSubmit} className="hidden md:flex items-center w-full max-w-sm relative">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-10 pl-4 pr-10 rounded-full bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-accent/60 transition-all backdrop-blur-sm"
        />
        <button type="submit" aria-label="Search anime" title="Cari anime" className="absolute right-3.5 text-zinc-500 hover:text-accent cursor-pointer">
          <Search className="w-4 h-4" />
        </button>
      </form>

      {/* Right User Actions */}
      <div className="flex items-center gap-4">
        {isAuthLoading ? (
          <div className="w-9 h-9 rounded-full bg-zinc-800/60 animate-pulse border border-zinc-800" />
        ) : isAuthenticated && user ? (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 focus:outline-none cursor-pointer group"
            >
              {user.avatar ? (
                <Image
                  src={user.avatar}
                  alt={user.name}
                  width={36}
                  height={36}
                  className="w-9 h-9 rounded-full object-cover border border-zinc-800 group-hover:border-accent transition-colors"
                />
              ) : (
                <div className="w-9 h-9 rounded-full border border-zinc-800 group-hover:border-accent transition-colors bg-zinc-800 flex items-center justify-center text-sm font-black text-accent">
                  {user.name?.[0]?.toUpperCase() ?? "U"}
                </div>
              )}
              <ChevronDown className="w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-colors hidden sm:block" />
            </button>

            {/* Dropdown Menu */}
            <AnimatePresence>
              {dropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -8 }}
                  transition={{ duration: 0.18, ease: [0.215, 0.610, 0.355, 1] }}
                  className="absolute right-0 mt-3 w-56 rounded-xl glass-dark border border-zinc-800 shadow-2xl p-1.5 flex flex-col gap-0.5 origin-top-right z-50"
                >
                  <div className="px-3 py-2 border-b border-zinc-800/60 mb-1">
                    <p className="text-sm font-semibold text-zinc-100 truncate">{user.name}</p>
                    <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                  </div>

                  <Link
                    href="/profile"
                    className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/60 rounded-lg transition-colors"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <User className="w-4 h-4 text-zinc-400" />
                    My Profile
                  </Link>

                  <Link
                    href="/watchlist"
                    className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/60 rounded-lg transition-colors"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Heart className="w-4 h-4 text-zinc-400" />
                    Watchlist
                  </Link>

                  <Link
                    href="/history"
                    className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/60 rounded-lg transition-colors"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <History className="w-4 h-4 text-zinc-400" />
                    History
                  </Link>

                  <Link
                    href="/profile/settings"
                    className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900/60 rounded-lg transition-colors"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <Settings className="w-4 h-4 text-zinc-400" />
                    Settings
                  </Link>

                  <button
                    onClick={() => {
                      logout();
                      setDropdownOpen(false);
                      router.push("/login");
                    }}
                    className="flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors mt-1 w-full text-left cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    Log Out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <Link href="/login">
            <Button size="sm">Sign In</Button>
          </Link>
        )}
      </div>
    </header>
  );
};
export default Navbar;