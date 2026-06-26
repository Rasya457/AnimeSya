"use client";

import React, { useEffect } from "react";
import { AlertCircle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AnimeDetailError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 text-center gap-5 px-6 select-none">
      <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 animate-pulse">
        <AlertCircle className="w-8 h-8" />
      </div>

      <div className="flex flex-col gap-2 max-w-md">
        <h2 className="text-xl font-bold text-zinc-100">Something went wrong!</h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          We encountered an error loading this anime's details. It might be due to a lost connection or an invalid item request.
        </p>
      </div>

      <div className="flex items-center gap-4 mt-2">
        <Button variant="primary" size="md" onClick={reset} icon={<RotateCcw className="w-4 h-4" />}>
          Try Again
        </Button>
        <Link href="/">
          <Button variant="outline" size="md" icon={<Home className="w-4 h-4" />}>
            Back Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
