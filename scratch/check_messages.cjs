const admin = require("firebase-admin");
const serviceAccount = require("../new-key.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function check() {
    console.log("=== CHECK ULTIME COMUNICAZIONI ===");
    const snap = await db.collection("comunicazioni_turni").orderBy("timestamp", "desc").limit(5).get();
    console.log(`Numero messaggi trovati: ${snap.size}`);
    snap.forEach(doc => {
        console.log(`ID: ${doc.id} -> Data:`, doc.data());
    });
}

check().catch(console.error);
