/**
 * Firebase Admin SDK — server-only, JANGAN import di client components.
 *
 * Butuh 3 env variable (server-only, TANPA NEXT_PUBLIC_):
 *   FIREBASE_ADMIN_PROJECT_ID
 *   FIREBASE_ADMIN_CLIENT_EMAIL
 *   FIREBASE_ADMIN_PRIVATE_KEY   ← wrap dengan "..." di .env.local, \n literal
 *
 * Cara dapat credentials:
 *   Firebase Console → Project Settings → Service Accounts → Generate new private key
 */
import { initializeApp, getApps, getApp, cert, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function createAdminApp(): App {
  // Guard: jangan re-init saat hot reload Next.js dev server
  if (getApps().length > 0) return getApp();

  const projectId   = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // PRIVATE_KEY di .env.local ditulis \n literal → perlu replace jadi actual newline
  const privateKey  = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "[firebase-admin] Missing env variables.\n" +
      "Pastikan FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, " +
      "dan FIREBASE_ADMIN_PRIVATE_KEY sudah diset di .env.local.\n" +
      "Download service account key dari:\n" +
      "Firebase Console → Project Settings → Service Accounts → Generate new private key"
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

const adminApp  = createAdminApp();
const adminAuth = getAuth(adminApp);
const adminDb   = getFirestore(adminApp);

export { adminApp, adminAuth, adminDb };
