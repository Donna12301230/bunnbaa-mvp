import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { app } from "./firebase";

// Firebase Console → 專案設定 → Cloud Messaging → Web Push 憑證 → 產生金鑰組。
// 這步免信用卡、跟 Blaze 無關，純粹是 Console 裡點一下就能拿到的 key，
// 拿到後貼進這裡（或改用 import.meta.env 從 .env.local 讀）。
const VAPID_KEY = "";

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
