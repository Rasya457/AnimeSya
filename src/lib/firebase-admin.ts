/**
 * lib/firebase-admin.ts
 *
 * Server only.
 * Jangan import di client component.
 *
 * PENTING: app/auth/db di-init LAZY (baru jalan pas dipanggil),
 * bukan langsung pas module ini di-import.
 *
 * Soalnya kalau pakai `export const adminAuth = getAuth(adminApp)`,
 * itu langsung dieksekusi pas Next.js fase "Collecting page data"
 * waktu build — bahkan kalau cuma satu route.ts yang import file ini.
 * Kalau env var belum ke-set di stage build (misal build di Docker
 * sebelum env runtime di-inject), build bakal gagal duluan walau
 * nanti pas runtime env-nya udah lengkap.
 */

import {
  initializeApp,
  getApps,
  getApp,
  cert,
  App,
} from "firebase-admin/app";

import { getAuth, Auth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";

function initAdmin(): App {
  // Hindari re-init
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey =
    process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `
[firebase-admin] Missing environment variables.

Pastikan environment berikut sudah ada:

FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY

Cara mendapatkan:
Firebase Console
→ Project Settings
→ Service Accounts
→ Generate new private key
      `
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });
}

// Singleton, tapi LAZY: baru ke-init pas getter-nya benar-benar dipanggil
let _adminApp: App | null = null;
let _adminAuth: Auth | null = null;
let _adminDb: Firestore | null = null;

function getAdminApp(): App {
  if (!_adminApp) {
    _adminApp = initAdmin();
  }
  return _adminApp;
}

export function getAdminAuth(): Auth {
  if (!_adminAuth) {
    _adminAuth = getAuth(getAdminApp());
  }
  return _adminAuth;
}

export function getAdminDb(): Firestore {
  if (!_adminDb) {
    _adminDb = getFirestore(getAdminApp());
  }
  return _adminDb;
}

// Proxy exports untuk mendukung kode lama yang meng-import instance langsung secara Lazy
export const adminAuth = new Proxy({} as Auth, {
  get(target, prop, receiver) {
    const instance = getAdminAuth();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  }
});

export const adminDb = new Proxy({} as Firestore, {
  get(target, prop, receiver) {
    const instance = getAdminDb();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  }
});