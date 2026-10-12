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

// Server sends data-only messages (functions/src/common.js notifyUser): show them here and remember which page to open
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || payload.notification || {};
  self.registration.showNotification(data.title || "BunnBaa", {
    body: data.body || "",
    icon: "/飯飽R.png",
    data: { link: data.link || "" },
  });
});

// Clicking a notification opens its page. Hash-route query strings must go in the real ?search (/profile?tab=points → /?tab=points#/profile),
// matching wouter's navigate; otherwise the page 404s
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
