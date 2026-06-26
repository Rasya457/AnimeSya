import React from "react";
import { Skeleton } from "@/components/ui/Skeleton";

export default function AnimeDetailLoading() {
  return (
    <div className="w-full pb-16 flex flex-col select-none relative animate-pulse">
      {/* Banner Skeleton */}
      <div className="w-full aspect-[21/9] md:h-[45vh] min-h-[260px] bg-zinc-900/60" />

      {/* Info Info Wrapper Skeleton */}
      <div className="max-w-7xl mx-auto w-full px-6 md:px-12 flex flex-col md:flex-row gap-8 md:gap-12 -mt-24 md:-mt-32 relative z-10">
        
        {/* Cover image skeleton */}
        <Skeleton className="w-48 sm:w-56 md:w-64 shrink-0 aspect-[3/4]" />

        {/* Text/details skeletons */}
        <div className="flex-1 flex flex-col gap-5 pt-0 md:pt-10">
          <Skeleton className="h-10 w-3/4 rounded-xl" />
          <Skeleton className="h-4 w-1/3 rounded-lg" />
          
          <div className="flex gap-4">
            <Skeleton className="h-5 w-20 rounded-md" />
            <Skeleton className="h-5 w-20 rounded-md" />
            <Skeleton className="h-5 w-20 rounded-md" />
          </div>

          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>

          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-5/6 rounded" />
          </div>

          <div className="flex gap-4 mt-2">
            <Skeleton className="h-12 w-40 rounded-full" />
            <Skeleton className="h-12 w-48 rounded-full" />
          </div>
        </div>

      </div>

      {/* Episodes List Skeleton */}
      <div className="max-w-7xl mx-auto w-full px-6 md:px-12 mt-12 flex flex-col gap-6">
        <Skeleton className="h-6 w-40 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-3 rounded-2xl bg-zinc-900/10 border border-zinc-900 p-2.5">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <div className="flex flex-col gap-2 px-1">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
