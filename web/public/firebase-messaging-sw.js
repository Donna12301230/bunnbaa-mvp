// Firebase must find this file at exactly /firebase-messaging-sw.js — it's
// what lets a push notification show up while the tab isn't focused/open.
// Service workers can't use ES module imports from our own src/, so the
// config is duplicated here (same values as web/src/lib/firebase.ts).
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBoHqJHb51AIbWn7OG4xMuoa4AfKAG0lHQ",
  authDomain: "bunnbaa-mvp-5474.firebaseapp.com",
  projectId: "bunnbaa-mvp-5474",
  storageBucket: "bunnbaa-mvp-5474.firebasestorage.app",
  messagingSenderId: "30970551327",
  appId: "1:30970551327:web:57c9a255a4558b6e51892a",
});

const messaging = firebase.messaging();

// 伺服器送 data-only 訊息（functions/src/common.js notifyUser）：這裡顯示，並記下要打開的頁面
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || payload.notification || {};
  self.registration.showNotification(data.title || "BunnBaa", {
    body: data.body || "",
    icon: "/飯飽R.png",
    data: { link: data.link || "" },
  });
});

// 點通知 → 打開對應頁面。hash 路由的 query 要放在真正的 ?search（/profile?tab=points → /?tab=points#/profile），
// 跟 wouter 的 navigate 一致，否則頁面會 404
function urlFor(link) {
  if (!link) return "/#/home";
  const [path, query] = String(link).split("?");
  return `/${query ? `?${query}` : ""}#${path.startsWith("/") ? path : `/${path}`}`;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(urlFor(event.notification.data && event.notification.data.link), self.location.origin).href;
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = all.find((c) => new URL(c.url).origin === self.location.origin);
    if (open) {
      await open.navigate(target).catch(() => undefined);
      return open.focus();
    }
    return clients.openWindow(target);
  })());
});
