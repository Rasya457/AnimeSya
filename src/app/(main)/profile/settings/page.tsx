"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Settings, User, Sliders, LogOut, Check, ArrowLeft, Camera, X } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { usePlayerStore } from "@/store/playerStore";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function SettingsPage() {
  const router = useRouter();
  const { user, updateProfile, logout } = useAuthStore();
  const { autoplay, setAutoplay } = usePlayerStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name,        setName]        = useState("");
  const [avatar,      setAvatar]      = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setAvatar(user.avatar ?? "");
    }
  }, [user]);

  if (!user) return null;

  // Convert uploaded image to base64 and set as avatar
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !user) return;

    // Kalau nama berubah, update semua komentar di localStorage yang pakai nama lama
    const oldName = user.name;
    if (oldName !== name.trim()) {
      try {
        Object.keys(localStorage)
          .filter(key => key.startsWith('comments-'))
          .forEach(key => {
            const stored = JSON.parse(localStorage.getItem(key) ?? '[]')
            const updated = stored.map((c: { author: string }) =>
              c.author === oldName ? { ...c, author: name.trim() } : c
            )
            localStorage.setItem(key, JSON.stringify(updated))
          })
      } catch { /* silent */ }
    }

    updateProfile({ name, avatar });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-6 md:px-12 py-8 flex flex-col gap-8 select-none">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-900 pb-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl md:text-2xl font-black text-zinc-100 flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-accent" />
            Account Settings
          </h2>
          <p className="text-xs text-zinc-500">Manage your profile, streaming preferences, and settings</p>
        </div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

        {/* Left Column: Edit Profile */}
        <form onSubmit={handleSave} className="md:col-span-2 flex flex-col gap-6 bg-zinc-900/10 border border-zinc-900 p-6 rounded-2xl">
          <h3 className="text-sm font-bold text-zinc-300 flex items-center gap-2 uppercase tracking-wider pb-2 border-b border-zinc-900/60">
            <User className="w-4 h-4 text-accent" />
            Profile Details
          </h3>

          {/* Avatar Upload */}
          <div className="flex flex-col gap-3">
            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              Profile Photo
            </label>
            <div className="flex items-center gap-4">

              {/* Avatar preview */}
              <div className="relative w-16 h-16 flex-shrink-0">
                {avatar ? (
                  <>
                    <img
                      src={avatar}
                      alt="Avatar"
                      className="w-16 h-16 rounded-full object-cover border border-zinc-700"
                    />
                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => setAvatar("")}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-zinc-800
                                 border border-zinc-700 flex items-center justify-center
                                 hover:bg-red-500/80 transition-colors"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </>
                ) : (
                  <div className="w-16 h-16 rounded-full border border-zinc-700 bg-zinc-800
                                  flex items-center justify-center text-zinc-300 font-bold text-xl">
                    {user.name?.[0]?.toUpperCase() ?? "U"}
                  </div>
                )}
              </div>

              {/* Upload button */}
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800
                             hover:bg-zinc-700 border border-zinc-700/50 text-xs font-semibold
                             text-zinc-300 hover:text-white transition-all cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Upload Photo
                </button>
                <p className="text-[10px] text-zinc-600">JPG, PNG, GIF — maks 5MB</p>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>

          <Input
            label="Display Name"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <Input
            label="Email Address"
            value={user.email}
            disabled
            className="opacity-55 cursor-not-allowed"
          />

          <div className="flex items-center justify-between mt-2">
            <Button type="submit" size="md">
              Save Changes
            </Button>
            {saveSuccess && (
              <span className="text-xs font-bold text-accent flex items-center gap-1.5 animate-bounce">
                <Check className="w-4 h-4" />
                Saved Successfully
              </span>
            )}
          </div>
        </form>

        {/* Right Column: Preferences */}
        <div className="flex flex-col gap-6 bg-zinc-900/10 border border-zinc-900 p-6 rounded-2xl">
          <h3 className="text-sm font-bold text-zinc-300 flex items-center gap-2 uppercase tracking-wider pb-2 border-b border-zinc-900/60">
            <Sliders className="w-4 h-4 text-accent" />
            Preferences
          </h3>

          {/* Autoplay toggle */}
          <div className="flex items-center justify-between py-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-zinc-300">Autoplay Next Episode</span>
              <span className="text-[10px] text-zinc-500">Automatically play the next queued title</span>
            </div>
            <button
              onClick={() => setAutoplay(!autoplay)}
              className={`w-10 h-6 rounded-full p-1 transition-colors cursor-pointer ${
                autoplay ? "bg-accent" : "bg-zinc-800"
              }`}
            >
              <div className={`w-4 h-4 rounded-full bg-zinc-950 transition-transform ${
                autoplay ? "translate-x-4" : "translate-x-0"
              }`} />
            </button>
          </div>

          {/* Preferred Audio */}
          <div className="flex items-center justify-between py-1 border-t border-zinc-900 pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-zinc-300">Preferred Audio</span>
              <span className="text-[10px] text-zinc-500">Primary audio track language</span>
            </div>
            <select className="h-8 rounded-lg px-2 bg-zinc-900 border border-zinc-800 text-[10px] font-bold text-zinc-300 outline-none">
              <option>Japanese (Sub)</option>
              <option>English (Dub)</option>
            </select>
          </div>

          {/* Sign Out */}
          <Button
            variant="outline"
            className="w-full border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 mt-6"
            onClick={() => { logout(); router.push("/login"); }}
            icon={<LogOut className="w-4 h-4" />}
          >
            Sign Out
          </Button>
        </div>

      </div>
    </div>
  );
}