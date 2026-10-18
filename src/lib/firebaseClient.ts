import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app, "gs://pay-0-system.firebasestorage.app");
export const functions = getFunctions(app, "us-central1");

// Bandera para activar emuladores desde .env.local o PowerShell
const USE_EMULATORS =
  process.env.NEXT_PUBLIC_USE_EMULATORS === "1" ||
  process.env.NEXT_PUBLIC_USE_EMULATORS === "true";


// Evita reconectar en hot reload
declare global {
  // eslint-disable-next-line no-var
  var __FIREBASE_EMULATORS_CONNECTED__: boolean | undefined;
}

if (typeof window !== "undefined" && USE_EMULATORS && !globalThis.__FIREBASE_EMULATORS_CONNECTED__) {
  // Si quieres probar en celular, cambia localhost por la IP de tu PC (ej. 192.168.1.25)
  const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || "127.0.0.1";

  try {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  } catch {}

  try {
    connectFirestoreEmulator(db, host, 8080);
  } catch {}

  try {
    connectStorageEmulator(storage, host, 9199);
  } catch {}

  try {
    connectFunctionsEmulator(functions, host, 5001);
  } catch {}

  globalThis.__FIREBASE_EMULATORS_CONNECTED__ = true;
}

export default app;



