import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getStorage, connectStorageEmulator } from "firebase/storage";

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
export const auth = getAuth(app);
export const storage = getStorage(app);

// Point at local emulators during development.
// Set VITE_USE_EMULATORS=true in a .env.local to enable.
// DEV only: vite build also reads .env.local, and without this guard production would connect to localhost.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
  connectFirestoreEmulator(db, "localhost", 8080);
  connectFunctionsEmulator(functions, "localhost", 5001);
  connectStorageEmulator(storage, "localhost", 9199);
  // disableWarnings: turns off the "Running in emulator mode. Do not use with production credentials."
  // warning banner the Firebase Auth SDK injects at the bottom of the page by default
  // (purely a UI notice; doesn't affect the emulator connection itself).
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
}
