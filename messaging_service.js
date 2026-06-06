import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, addDoc, query, where, onSnapshot, orderBy, limit, updateDoc, doc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAc_ZXW_6QXvG9yHRMxB3dbZEp9X8qTTzg",
  authDomain: "turni-sda.firebaseapp.com",
  projectId: "turni-sda",
  storageBucket: "turni-sda.firebasestorage.app",
  messagingSenderId: "840030023706",
  appId: "1:840030023706:web:1a6f738ed3051075c5a1a3"
};

let app, db;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase init error in messaging_service:", e);
}

window.AppMessaging = {
    // A. Send a message using a standard root collection (gestione-corso120 style)
    sendMessage: async (mittente, destinatario, testo, tipo = "comunicazione_generica", parametri_push = null) => {
        if (!testo || !String(testo).trim()) return { success: false, error: "Testo vuoto" };
        
        try {
            const payload = {
                mittente_matricola: String(mittente).trim(),
                destinatario_matricola: String(destinatario).trim(),
                testo: String(testo).trim(),
                tipo: String(tipo).trim(),
                timestamp: new Date().toISOString(),
                letto: false
            };
            
            if (parametri_push) {
                payload.parametri_push = parametri_push;
            }
            
            const docRef = await addDoc(collection(db, "comunicazioni_turni"), payload);
            console.log(`[MESSAGING] Messaggio inviato con ID: ${docRef.id}`);
            return { success: true, id: docRef.id };
        } catch (err) {
            console.error("[MESSAGING_ERROR] Fallimento invio messaggio:", err);
            return { success: false, error: err.message || err };
        }
    },

    // B. Real-time listener using standard query
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
            snapshot.forEach((docSnap) => {
                messaggi.push({ id: docSnap.id, ...docSnap.data() });
            });
            console.log(`[MESSAGING] Ricevuti ${messaggi.length} messaggi in tempo reale.`);
            if (typeof callbackUI === "function") {
                callbackUI(messaggi);
            }
        }, (err) => {
            console.error("[MESSAGING_ERROR] Errore durante l'ascolto dei messaggi:", err);
        });
    },

    // C. Mark as read by document ID
    markAsRead: async (idMessaggio) => {
        if (!idMessaggio) return;
        try {
            const docRef = doc(db, "comunicazioni_turni", String(idMessaggio).trim());
            await updateDoc(docRef, { letto: true });
            console.log(`[MESSAGING] Messaggio ${idMessaggio} segnato come letto.`);
        } catch (err) {
            console.error("[MESSAGING_ERROR] Impossibile aggiornare stato lettura:", err);
        }
    }
};
