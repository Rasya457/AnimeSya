"use client";

import { useCallback, useRef } from "react";

interface UseInfiniteScrollOptions {
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  threshold?: number; // px from bottom edge before triggering
}

/**
 * useInfiniteScroll — attaches an IntersectionObserver to a sentinel ref.
 * Attach the returned `sentinelRef` to a <div> at the bottom of your list.
 */
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  isLoading,
  threshold = 200,
}: UseInfiniteScrollOptions) {
  const observerRef = useRef<IntersectionObserver | null>(null);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isLoading) return;

      // Disconnect any previous observer
      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      if (!node || !hasMore) return;

      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            onLoadMore();
          }
        },
        { rootMargin: `0px 0px ${threshold}px 0px` }
      );

      observerRef.current.observe(node);
    },
    [isLoading, hasMore, onLoadMore, threshold]
  );

  return { sentinelRef };
}
