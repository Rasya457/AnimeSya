"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, Send } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Email is required");
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError("Invalid email format");
      return;
    }
    setError("");
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background Radial Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-accent/10 blur-[120px] pointer-events-none" />

      {/* Card */}
      <div className="w-full max-w-md rounded-2xl glass-dark border border-zinc-800/80 p-8 shadow-2xl flex flex-col gap-6 relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-300">
        
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <Link href="/" className="flex items-center gap-2 group mb-2">
            <span className="text-2xl font-black tracking-tight bg-gradient-to-r from-accent to-emerald-400 bg-clip-text text-transparent group-hover:opacity-90">
              AnimeSya
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          </Link>
          <h2 className="text-xl font-bold text-zinc-100">Reset Password</h2>
          <p className="text-xs text-zinc-500">We will send you a recovery link</p>
        </div>

        {submitted ? (
          <div className="flex flex-col gap-5 text-center items-center py-4">
            <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent animate-bounce">
              <Send className="w-6 h-6" />
            </div>
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-bold text-zinc-200">Email Sent!</h4>
              <p className="text-xs text-zinc-500 max-w-xs leading-5">
                Check your inbox at <span className="text-zinc-300 font-semibold">{email}</span>. Click the link inside to set a new password.
              </p>
            </div>
            <Link href="/login" className="mt-2 w-full">
              <Button variant="outline" className="w-full" icon={<ArrowLeft className="w-4 h-4" />}>
                Back to Sign In
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Email Address"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              leftIcon={<Mail className="w-4.5 h-4.5" />}
              error={error}
              type="email"
            />

            <Button type="submit" className="w-full mt-2" icon={<Send className="w-4.5 h-4.5" />}>
              Send Recovery Link
            </Button>

            <Link href="/login" className="flex items-center justify-center gap-2 text-xs text-zinc-400 hover:text-accent font-semibold transition-colors mt-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </Link>
          </form>
        )}

      </div>
    </div>
  );
}
