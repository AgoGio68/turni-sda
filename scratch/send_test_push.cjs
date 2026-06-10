const admin = require("firebase-admin");
const serviceAccount = require("../turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const token = "e6Re_Q1ajwvsw9B4ywgh_B:APA91bETgyev4RnCwxUR-cacifaqF_ETYn2r4mXIEbDhNJvBwoFo_nOdQU7YyQDCIgWJdRWhiPwK4FlExyuGbN2YmuUJVRN37qMwMqHuiNAu0rWrhI8PHYY";

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
