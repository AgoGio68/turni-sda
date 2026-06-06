importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAc_ZXW_6QXvG9yHRMxB3dbZEp9X8qTTzg",
  authDomain: "turni-sda.firebaseapp.com",
  projectId: "turni-sda",
  storageBucket: "turni-sda.firebasestorage.app",
  messagingSenderId: "840030023706",
  appId: "1:840030023706:web:1a6f738ed3051075c5a1a3"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log("[SW_BACKGROUND] Ricevuta notifica push in background:", payload);
    const notificationTitle = payload.data?.title || payload.notification?.title || "Avviso Urgente Turni";
    const notificationOptions = {
        body: payload.data?.body || payload.notification?.body || "Controlla le ultime variazioni sul tabellone.",
        icon: "assets/icons/icon-192x192.png",
        badge: "assets/icons/icon-72x72.png",
        sound: "assets/audio/alarm.mp3",
        tag: "urgente-servizio",
        renotify: true
    };
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) return clientList[0].focus();
            return clients.openWindow("/");
        })
    );
});
