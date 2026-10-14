import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { app } from "./firebase";

// Firebase Console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair.
// This step needs no credit card and has nothing to do with Blaze; it's just a key you get with one click in the Console.
// Paste it here once you have it (or read it from .env.local via import.meta.env instead).
const VAPID_KEY = "BCFVXCWoIbTmVcU9mQs5_PDhhUlDoceytu711JkCQ_2-ur33RqaFbdz425OpWVTHK4R0OGsIhzx8HHmmWPVRHwY";

/**
 * Best-effort: asks for notification permission and registers an FCM token
 * for this device. Returns null (never throws) if the browser doesn't
 * support push, permission is denied, or VAPID_KEY hasn't been filled in —
 * pickup reminders are a nice-to-have, not something that should block the
 * lock flow.
 */
export async function registerForPickupReminders(): Promise<string | null> {
  try {
    if (!VAPID_KEY) {
      console.warn("VAPID_KEY not set in web/src/lib/messaging.ts — skipping push registration.");
      return null;
    }
    if (!(await isSupported())) return null;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    return await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  } catch (err) {
    console.warn("FCM registration failed, continuing without pickup reminders:", err);
    return null;
  }
}
