const admin = require("firebase-admin");
const serviceAccount = require("../turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function check() {
    console.log("=== CHECK DISPOSITIVI NOTIFICHE ===");
    const snap = await db.collection("dispositivi_notifiche").get();
    console.log(`Numero dispositivi registrati: ${snap.size}`);
    snap.forEach(doc => {
        console.log(`Matricola: ${doc.id} -> Data:`, doc.data());
    });
}

check().catch(console.error);
