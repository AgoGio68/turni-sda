const admin = require("firebase-admin");
const serviceAccount = require("../new-key.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const token = "dmUfBBnyUv24fH6kfXyc8Q:APA91bGiHLvI4rbyX9JdPTlYXxJvMsJlqfP6mUHQkI6bA3kDKXs49Eq3m23vbwaCsmZFyvwAfPyrx0WkWKut564WenOby3lt3gViyLAS9VvgblQbo2wlssI";

const payload = {
    notification: {
        title: "Test Manuale Antigravity",
        body: "Se vedi questo, il canale di comunicazione FCM funziona!",
    },
    data: {
        title: "Test Manuale Antigravity",
        body: "Se vedi questo, il canale di comunicazione FCM funziona!",
        click_action: "FLUTTER_NOTIFICATION_CLICK"
    },
    webpush: {
        headers: {
            Urgency: "high"
        },
        notification: {
            title: "Test Manuale Antigravity",
            body: "Se vedi questo, il canale di comunicazione FCM funziona!",
            icon: "/assets/icons/icon-192x192.png",
            badge: "/assets/icons/icon-72x72.png",
            sound: "assets/audio/alarm.mp3",
            requireInteraction: true
        }
    }
};

async function send() {
    console.log("Invio messaggio push di test...");
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
