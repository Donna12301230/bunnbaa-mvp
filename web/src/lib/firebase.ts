import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import {
  initializeAuth,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import type { FirebaseStorage } from "firebase/storage";

// Fill these in from your Firebase project settings, or load from
// import.meta.env (Vite) if you prefer environment-based config.
const firebaseConfig = {
  apiKey: "AIzaSyBoHqJHb51AIbWn7OG4xMuoa4AfKAG0lHQ",
  authDomain: "bunnbaa-mvp-5474.firebaseapp.com",
  projectId: "bunnbaa-mvp-5474",
  storageBucket: "bunnbaa-mvp-5474.firebasestorage.app",
  messagingSenderId: "30970551327",
  appId: "1:30970551327:web:57c9a255a4558b6e51892a",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app, "asia-east1");
// initializeAuth instead of getAuth: same persistence as getAuth's default, but without the popup/redirect
// resolver. We don't use Google popup/redirect sign-in, and on mobile browsers that resolver eagerly loads gapi
// from apis.google.com plus the firebaseapp.com auth iframe (~130KB) on every page load.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});

const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";

// Storage is only used for vendor image uploads, so it's loaded on first use instead of in the main bundle
let _storage: Promise<FirebaseStorage> | null = null;
export function getStorageInstance(): Promise<FirebaseStorage> {
  _storage ??= import("firebase/storage").then(({ getStorage, connectStorageEmulator }) => {
    const storage = getStorage(app);
    if (useEmulators) connectStorageEmulator(storage, "localhost", 9199);
    return storage;
  });
  return _storage;
}

// Point at local emulators during development.
// Set VITE_USE_EMULATORS=true in a .env.local to enable.
// DEV only: vite build also reads .env.local, and without this guard production would connect to localhost.
if (useEmulators) {
  connectFirestoreEmulator(db, "localhost", 8080);
  connectFunctionsEmulator(functions, "localhost", 5001);
  // disableWarnings: turns off the "Running in emulator mode. Do not use with production credentials."
  // warning banner the Firebase Auth SDK injects at the bottom of the page by default
  // (purely a UI notice; doesn't affect the emulator connection itself).
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
}
