import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'node:fs';

// Server-side Firebase (Admin SDK). Credentials: FIREBASE_SERVICE_ACCOUNT_FILE points at a
// service-account JSON key; otherwise Application Default Credentials are used.
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'simchacard-d87c1';
const bucketName = process.env.FIREBASE_STORAGE_BUCKET ?? `${FIREBASE_PROJECT_ID}.firebasestorage.app`;

function app() {
  if (getApps().length) return getApps()[0];
  const keyFile = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  return initializeApp({
    credential: keyFile ? cert(JSON.parse(readFileSync(keyFile, 'utf8'))) : applicationDefault(),
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: bucketName,
  });
}

export const firestore = () => getFirestore(app());
export const bucket = () => getStorage(app()).bucket();
