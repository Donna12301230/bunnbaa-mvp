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

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || "BunnBaa", {
    body: body || "",
    icon: "/飯飽R.png",
  });
});
