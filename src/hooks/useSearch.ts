"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * useSearch — debounced search hook
 * @param delay  Debounce delay in ms (default 350)
 */
export function useSearch(delay = 350) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (query.trim().length === 0) {
      setDebounced("");
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    timerRef.current = setTimeout(() => {
      setDebounced(query.trim());
      setIsSearching(false);
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, delay]);

  const clear = useCallback(() => {
    setQuery("");
    setDebounced("");
    setIsSearching(false);
  }, []);

  return { query, setQuery, debounced, isSearching, clear };
}
