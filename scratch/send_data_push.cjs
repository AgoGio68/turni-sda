const admin = require("firebase-admin");
const serviceAccount = require("../new-key.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const token = "dmUfBBnyUv24fH6kfXyc8Q:APA91bGiHLvI4rbyX9JdPTlYXxJvMsJlqfP6mUHQkI6bA3kDKXs49Eq3m23vbwaCsmZFyvwAfPyrx0WkWKut564WenOby3lt3gViyLAS9VvgblQbo2wlssI";

// Data-only payload (NO 'notification' block) to force SW execution
const payload = {
    data: {
        title: "Test Solo Dati Antigravity",
        body: "Questo messaggio forza l'esecuzione del Service Worker!",
    },
    webpush: {
        headers: {
            Urgency: "high"
        },
        // We do NOT put notification here to ensure browser doesn't intercept it
    }
};

async function send() {
    console.log("Invio messaggio push (SOLO DATI) di test...");
    try {
        const response = await admin.messaging().send({
            token: token,
            ...payload
        });
        console.log("Successo! ID Messaggio:", response);
    } catch (error) {
        console.error("Errore durante l'invio:", error);
    }
}

send().catch(console.error);
