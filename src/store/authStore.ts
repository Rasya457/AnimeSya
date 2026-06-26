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

// Helper: sync cookie untuk middleware & server-side auth guard.
// PENTING: isinya sekarang ID token Firebase ASLI (bukan flag "1" lagi),
// soalnya middleware.ts & admin layout butuh token yang bisa diverifikasi
// pakai firebase-admin.verifyIdToken() di server.
function setAuthCookie(idToken: string) {
  if (typeof document !== "undefined") {
    document.cookie = `auth-storage=${idToken}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  }
}

function clearAuthCookie() {
  if (typeof document !== "undefined") {
    document.cookie = "auth-storage=; path=/; max-age=0";
  }
}

// Variabel untuk menampung fungsi unsubscribe snapshot listener
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

      login: async (email, password = "") => {
        try {
          const credential = await signInWithEmailAndPassword(auth, email, password);
          setAuthCookie(await credential.user.getIdToken());

          // Ambil role asli dari Firestore — sama prinsipnya kayak loginWithGoogle,
          // jangan whitelist field role mentah tanpa dicek.
          const userDoc = await getDoc(doc(db, "users", credential.user.uid));
          const role: "user" | "admin" = userDoc.exists() && userDoc.data()?.role === "admin" ? "admin" : "user";

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

          // Update display name di Firebase Auth
          await firebaseUpdateProfile(fUser, { displayName: name });

          // Buat profil Firestore — role WAJIB hardcode "user" di sini.
          // Security Rules juga ngecek ini ulang di server, jadi dobel aman:
          // client gak bisa daftar langsung jadi admin walau payload diubah manual.
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
          const userCredential = await signInWithPopup(auth, provider);
          const fUser = userCredential.user;

          // Cek apakah data user sudah ada di Firestore
          const userDocRef = doc(db, "users", fUser.uid);
          const userDoc = await getDoc(userDocRef);

          let role: "user" | "admin" = "user";

          if (!userDoc.exists()) {
            // Buat profil default jika baru pertama kali — role tetap "user"
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
            // role udah "user", gak perlu diubah
          } else {
            // User lama — ambil role asli dari Firestore, jangan percaya
            // field mentah tanpa whitelist (sama kayak prinsip di onIdTokenChanged).
            role = userDoc.data()?.role === "admin" ? "admin" : "user";
          }

          setAuthCookie(await fUser.getIdToken());
          return { role };
        } catch (error: any) {
          console.error("Google Login error:", error);
          throw error;
        }
      },

      logout: async () => {
        try {
          clearAuthCookie();
          clearListeners();
          await signOut(auth);
          set({
            isAuthenticated: false,
            user: null,
            watchlist: [],
            history: [],
          });
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

          // Jika progres sudah di atas 90% dan baru pertama kali selesai, update stats
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
      // Hanya persist user & isAuthenticated — watchlist & history selalu
      // fresh dari Firestore (onSnapshot), tidak perlu disimpan di localStorage.
      // Ini mencegah data akun lama bocor ke akun baru.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Jalankan Auth State Listener secara global.
// Pakai onIdTokenChanged (bukan onAuthStateChanged) karena ini juga fire
// setiap kali Firebase SDK auto-refresh ID token di background (tiap ~1 jam),
// jadi cookie selalu berisi token yang masih valid tanpa perlu logic refresh manual.
if (typeof window !== "undefined") {
  onIdTokenChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      setAuthCookie(await firebaseUser.getIdToken());

      // Hapus listener lama jika ada (cegah listener dobel saat token refresh)
      clearListeners();

      // 1. Dapatkan dan Dengarkan Profil User
      const userDocRef = doc(db, "users", firebaseUser.uid);
      unsubscribeProfile = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          useAuthStore.setState({
            isAuthenticated: true,
            user: {
              id: firebaseUser.uid,
              name: data.name || firebaseUser.displayName || "User",
              email: data.email || firebaseUser.email || "",
              avatar: data.avatar || firebaseUser.photoURL || undefined,
              joinedAt: data.joinedAt || "Jun 2025",
              watchTime: data.watchTime || 0,
              episodesCount: data.episodesCount || 0,
              // Default ke "user" kalau field gak ada / bukan "admin" yang valid —
              // jangan pernah percaya field role mentah dari Firestore tanpa whitelist.
              role: data.role === "admin" ? "admin" : "user",
            },
          });
        }
      });

      // 2. Dengarkan Watchlist Collection
      const watchlistColRef = collection(db, "users", firebaseUser.uid, "watchlist");
      unsubscribeWatchlist = onSnapshot(watchlistColRef, (snapshot) => {
        const list: WatchlistItem[] = [];
        snapshot.forEach((d) => {
          list.push(d.data() as WatchlistItem);
        });
        useAuthStore.setState({ watchlist: list });
      });

      // 3. Dengarkan History Collection
      const historyColRef = collection(db, "users", firebaseUser.uid, "history");
      unsubscribeHistory = onSnapshot(historyColRef, (snapshot) => {
        const list: HistoryItem[] = [];
        snapshot.forEach((d) => {
          list.push(d.data() as HistoryItem);
        });
        useAuthStore.setState({ history: list });
      });
    } else {
      clearAuthCookie();
      clearListeners();
      useAuthStore.setState({
        isAuthenticated: false,
        user: null,
        watchlist: [],
        history: [],
      });
    }
  });
}