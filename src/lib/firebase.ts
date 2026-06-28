import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Cek apakah API Key tersedia (bisa saja kosong di build server Vercel sebelum env var diset)
const canInitialize = !!firebaseConfig.apiKey;

let app: any = null;
let auth: any = null;
let db: any = null;

if (canInitialize) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (error) {
    console.error("Firebase client initialization failed:", error);
  }
} else {
  // Mock fallback agar build Next.js (prerendering) tidak crash karena Firebase error
  auth = {} as any;
  db = {} as any;
}

export { app, auth, db };