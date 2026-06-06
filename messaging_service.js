import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, updateDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyAc_ZXW_6QXvG9yHRMxB3dbZEp9X8qTTzg",
  authDomain: "turni-sda.firebaseapp.com",
  projectId: "turni-sda",
  storageBucket: "turni-sda.firebasestorage.app",
  messagingSenderId: "840030023706",
  appId: "1:840030023706:web:1a6f738ed3051075c5a1a3"
};

let app, db, messaging;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  messaging = getMessaging(app);
} catch (e) {
  console.error("Firebase init error in messaging_service:", e);
}

// Inserisci qui la chiave VAPID estratta dalle impostazioni di Cloud Messaging se vuoi registrare i token
const VAPID_KEY = "CHIAVE_VAPID_DEFAULTS_DA_CONSOLE_SE_GENERATA";

window.AppMessaging = {
    sendMessage: async (mittente, destinatario, testo, tipo = "comunicazione_generica", opzioniPush = {}) => {
        if (!testo || !String(testo).trim()) return { success: false, error: "Testo vuoto" };
        try {
            const payload = {
                mittente_matricola: String(mittente).trim(),
                destinatario_matricola: String(destinatario).trim(),
                testo: String(testo).trim(),
                tipo: String(tipo).trim(),
                timestamp: new Date().toISOString(),
                letto: false,
                notifica: {
                    richiede_push: opzioniPush.richiede_notifica_push || false,
                    urgente: opzioniPush.urgente || false,
                    suono: opzioniPush.suono || "default",
                    titolo: opzioniPush.titolo_notifica || "Nuovo Messaggio"
                }
            };
            const docRef = await addDoc(collection(db, "comunicazioni_turni"), payload);
            return { success: true, id: docRef.id };
        } catch (err) {
            return { success: false, error: err.message || err };
        }
    },

    listenForMessages: (matricolaUtente, callbackUI) => {
        if (!matricolaUtente) return null;
        const q = query(
            collection(db, "comunicazioni_turni"),
            where("destinatario_matricola", "in", [String(matricolaUtente).trim(), "ALL"]),
            orderBy("timestamp", "desc"),
            limit(50)
        );
        return onSnapshot(q, (snapshot) => {
            const messaggi = [];
            snapshot.forEach((docSnap) => { messaggi.push({ id: docSnap.id, ...docSnap.data() }); });
            if (typeof callbackUI === "function") callbackUI(messaggi);
        }, (err) => { console.error("Errore ascolto:", err); });
    },

    markAsRead: async (idMessaggio) => {
        if (!idMessaggio) return;
        try {
            await updateDoc(doc(db, "comunicazioni_turni", String(idMessaggio).trim()), { letto: true });
        } catch (err) { console.error("Errore markAsRead:", err); }
    },

    requestNotificationPermissions: async (matricolaUtente) => {
        if (!matricolaUtente || !messaging) return;
        try {
            const permission = await Notification.requestPermission();
            if (permission === "granted") {
                const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY }).catch((e) => {
                    console.warn("[FCM] Impossibile recuperare il token (manca VAPID key o configurazione HTTPS):", e);
                    return null;
                });
                if (currentToken) {
                    await setDoc(doc(db, "dispositivi_notifiche", String(matricolaUtente).trim()), {
                        token_fcm: currentToken,
                        ultimo_aggiornamento: new Date().toISOString(),
                        piattaforma: "web_browser"
                    }, { merge: true });
                    console.log("[FCM] Token registrato correttamente per la matricola:", matricolaUtente);
                }
            }
        } catch (err) { console.error("Errore permessi push:", err); }
    },

    listenInForeground: () => {
        if (!messaging) return;
        onMessage(messaging, (payload) => {
            const audio = new Audio("assets/audio/alarm.mp3");
            audio.play().catch(() => console.log("Riproduzione audio bloccata dalle policy del browser. Serve un click."));
            alert(`🚨 ${payload.notification?.title || 'AVVISO URGENTE'}\n\n${payload.notification?.body || payload.data?.body || ''}`);
        });
    }
};
