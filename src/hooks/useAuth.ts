"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";

/** Hook wrapping authStore + navigation helpers */
export function useAuth() {
  const router = useRouter();
  const store = useAuthStore();

  const loginAndRedirect = useCallback(
    (email: string, name?: string, redirectTo = "/") => {
      store.login(email, name);
      router.push(redirectTo);
    },
    [store, router]
  );

  const registerAndRedirect = useCallback(
    (name: string, email: string, redirectTo = "/") => {
      store.register(name, email);
      router.push(redirectTo);
    },
    [store, router]
  );

  const logoutAndRedirect = useCallback(
    (redirectTo = "/login") => {
      store.logout();
      router.push(redirectTo);
    },
    [store, router]
  );

  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    watchlist: store.watchlist,
    history: store.history,
    login: loginAndRedirect,
    register: registerAndRedirect,
    logout: logoutAndRedirect,
    updateProfile: store.updateProfile,
  };
}
