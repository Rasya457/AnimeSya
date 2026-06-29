import { create } from "zustand";
import { persist } from "zustand/middleware";
import { User, WatchlistItem, HistoryItem, WatchlistStatus } from "@/types/auth";
import { auth, db } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  signInWithPopup,
  GoogleAuthProvider,
  onIdTokenChanged,
  updateProfile as firebaseUpdateProfile,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  collection,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";

interface AuthState {
  user: User | null;
  watchlist: WatchlistItem[];
  history: HistoryItem[];
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  login: (email: string, password?: string) => Promise<{ role: "user" | "admin" }>;
  register: (name: string, email: string, password?: string) => Promise<void>;
  loginWithGoogle: () => Promise<{ role: "user" | "admin" }>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<Omit<User, "id" | "joinedAt" | "role">>) => Promise<void>;
  addToWatchlist: (animeId: string, status: WatchlistStatus) => Promise<void>;
  removeFromWatchlist: (animeId: string) => Promise<void>;
  updateWatchHistory: (
    animeId: string,
    episodeId: string,
    progress: number,
    lastPlayedTime: number
  ) => Promise<void>;
}

function setAuthCookie(idToken: string) {
  if (typeof document !== "undefined") {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `auth-storage=${idToken}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax${secure}`;
  }
}

function clearAuthCookie() {
  if (typeof document !== "undefined") {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `auth-storage=; path=/; max-age=0; SameSite=Lax${secure}`;
  }
}

let unsubscribeWatchlist: (() => void) | null = null;
let unsubscribeHistory: (() => void) | null = null;
let unsubscribeProfile: (() => void) | null = null;

function clearListeners() {
  if (unsubscribeWatchlist) {
    unsubscribeWatchlist();
    unsubscribeWatchlist = null;
  }
  if (unsubscribeHistory) {
    unsubscribeHistory();
    unsubscribeHistory = null;
  }
  if (unsubscribeProfile) {
    unsubscribeProfile();
    unsubscribeProfile = null;
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      watchlist: [],
      history: [],
      isAuthenticated: false,
      isAuthLoading: true,

      login: async (email, password = "") => {
        try {
          const credential = await signInWithEmailAndPassword(auth, email, password);
          setAuthCookie(await credential.user.getIdToken());

          const userDoc = await getDoc(doc(db, "users", credential.user.uid));
          const role: "user" | "admin" =
            userDoc.exists() && userDoc.data()?.role === "admin" ? "admin" : "user";

          return { role };
        } catch (error: any) {
          console.error("Login error:", error);
          throw error;
        }
      },

      register: async (name, email, password = "") => {
        try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const fUser = userCredential.user;

          await firebaseUpdateProfile(fUser, { displayName: name });

          const userDocRef = doc(db, "users", fUser.uid);
          const profileData = {
            id: fUser.uid,
            name,
            email,
            role: "user" as const,
            joinedAt: new Date().toLocaleDateString("id-ID", {
              month: "short",
              year: "numeric",
            }),
            watchTime: 0,
            episodesCount: 0,
          };
          await setDoc(userDocRef, profileData);
          setAuthCookie(await fUser.getIdToken());
        } catch (error: any) {
          console.error("Register error:", error);
          throw error;
        }
      },

      loginWithGoogle: async () => {
        try {
          const provider = new GoogleAuthProvider();
          
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
          );

          if (isMobile) {
            const { signInWithRedirect } = await import("firebase/auth");
            // Set loading state to prevent flickering
            useAuthStore.setState({ isAuthLoading: true });
            await signInWithRedirect(auth, provider);
            // Function ends here because page will redirect
            return { role: "user" as const };
          }

          const userCredential = await signInWithPopup(auth, provider);
          const fUser = userCredential.user;

          const userDocRef = doc(db, "users", fUser.uid);
          const userDoc = await getDoc(userDocRef);

          let role: "user" | "admin" = "user";

          if (!userDoc.exists()) {
            const profileData = {
              id: fUser.uid,
              name: fUser.displayName || fUser.email?.split("@")[0] || "Otaku",
              email: fUser.email || "",
              avatar: fUser.photoURL || undefined,
              role: "user" as const,
              joinedAt: new Date().toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              }),
              watchTime: 0,
              episodesCount: 0,
            };
            await setDoc(userDocRef, profileData);
          } else {
            role = userDoc.data()?.role === "admin" ? "admin" : "user";
          }

          setAuthCookie(await fUser.getIdToken());
          return { role };
        } catch (error: any) {
          console.error("Google login error:", error);
          throw error;
        }
      },

      logout: async () => {
        try {
          clearAuthCookie();
          clearListeners();
          currentUserId = null;
          await signOut(auth);
          set({
            isAuthenticated: false,
            user: null,
            watchlist: [],
            history: [],
            isAuthLoading: false,
          });
          useAuthStore.persist.clearStorage();
        } catch (error: any) {
          console.error("Logout error:", error);
          throw error;
        }
      },

      updateProfile: async (updates) => {
        const currentUser = get().user;
        if (!currentUser) return;
        try {
          const userDocRef = doc(db, "users", currentUser.id);
          await updateDoc(userDocRef, updates);
        } catch (error: any) {
          console.error("Update profile error:", error);
          throw error;
        }
      },

      addToWatchlist: async (animeId, status) => {
        const currentUser = get().user;
        if (!currentUser) return;
        try {
          const docRef = doc(db, "users", currentUser.id, "watchlist", animeId);
          await setDoc(docRef, {
            animeId,
            status,
            addedAt: new Date().toISOString(),
          });
        } catch (error: any) {
          console.error("Add to watchlist error:", error);
        }
      },

      removeFromWatchlist: async (animeId) => {
        const currentUser = get().user;
        if (!currentUser) return;
        try {
          const docRef = doc(db, "users", currentUser.id, "watchlist", animeId);
          await deleteDoc(docRef);
        } catch (error: any) {
          console.error("Remove from watchlist error:", error);
        }
      },

      updateWatchHistory: async (animeId, episodeId, progress, lastPlayedTime) => {
        const currentUser = get().user;
        if (!currentUser) return;
        try {
          const docId = `${animeId}__${episodeId}`;
          const docRef = doc(db, "users", currentUser.id, "history", docId);

          await setDoc(docRef, {
            animeId,
            episodeId,
            progress,
            lastPlayedTime,
            watchedAt: new Date().toISOString(),
          });

          if (progress > 90) {
            const isCompleted = get().history.some(
              (h) => h.animeId === animeId && h.episodeId === episodeId && h.progress > 90
            );
            if (!isCompleted) {
              const userDocRef = doc(db, "users", currentUser.id);
              await updateDoc(userDocRef, {
                episodesCount: (currentUser.episodesCount || 0) + 1,
                watchTime: (currentUser.watchTime || 0) + 24,
              });
            }
          }
        } catch (error: any) {
          console.error("Update history error:", error);
        }
      },
    }),
    {
      name: "animesya-auth",
      version: 2,
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

let currentUserId: string | null = null;

if (typeof window !== "undefined") {
  // Handle redirect sign-in result on mount (for mobile flow)
  import("firebase/auth").then(({ getRedirectResult }) => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (result) {
          const fUser = result.user;
          const userDocRef = doc(db, "users", fUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            const profileData = {
              id: fUser.uid,
              name: fUser.displayName || fUser.email?.split("@")[0] || "Otaku",
              email: fUser.email || "",
              avatar: fUser.photoURL || undefined,
              role: "user" as const,
              joinedAt: new Date().toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              }),
              watchTime: 0,
              episodesCount: 0,
            };
            await setDoc(userDocRef, profileData);
          }
          setAuthCookie(await fUser.getIdToken());
        }
      })
      .catch((error) => {
        console.error("Error handling Google redirect login:", error);
      });
  });

  onIdTokenChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      const isNewUser = currentUserId !== firebaseUser.uid;

      if (isNewUser) {
        // ✅ 1. Stop listener lama DULU biar gak bisa fire lagi
        clearListeners();

        // ✅ 2. Baru reset state — aman karena listener lama udah mati
        useAuthStore.setState({
          user: null,
          watchlist: [],
          history: [],
          isAuthenticated: false,
          isAuthLoading: true,
        });

        currentUserId = firebaseUser.uid;
      }

      setAuthCookie(await firebaseUser.getIdToken());

      // ✅ 3. Setup listener baru hanya kalau user beneran ganti
      //    Skip kalau cuma token refresh tiap ~1 jam
      if (isNewUser) {
        const userDocRef = doc(db, "users", firebaseUser.uid);
        unsubscribeProfile = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data();
            useAuthStore.setState({
              isAuthenticated: true,
              isAuthLoading: false,
              user: {
                id: firebaseUser.uid,
                name: data.name || firebaseUser.displayName || "User",
                email: data.email || firebaseUser.email || "",
                avatar: data.avatar || firebaseUser.photoURL || undefined,
                joinedAt: data.joinedAt || "Jun 2025",
                watchTime: data.watchTime || 0,
                episodesCount: data.episodesCount || 0,
                role: data.role === "admin" ? "admin" : "user",
              },
            });
          } else {
            useAuthStore.setState({ isAuthLoading: false });
          }
        });

        const watchlistColRef = collection(db, "users", firebaseUser.uid, "watchlist");
        unsubscribeWatchlist = onSnapshot(watchlistColRef, (snapshot) => {
          const list: WatchlistItem[] = [];
          snapshot.forEach((d) => list.push(d.data() as WatchlistItem));
          useAuthStore.setState({ watchlist: list });
        });

        const historyColRef = collection(db, "users", firebaseUser.uid, "history");
        unsubscribeHistory = onSnapshot(historyColRef, (snapshot) => {
          const list: HistoryItem[] = [];
          snapshot.forEach((d) => list.push(d.data() as HistoryItem));
          useAuthStore.setState({ history: list });
        });
      } else {
        // Jika token doang yang terefresh, loading sudah pasti false
        useAuthStore.setState({ isAuthLoading: false });
      }
    } else {
      currentUserId = null;
      clearAuthCookie();
      clearListeners();
      useAuthStore.setState({
        isAuthenticated: false,
        user: null,
        watchlist: [],
        history: [],
        isAuthLoading: false,
      });
    }
  });
}