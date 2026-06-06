const admin = require("firebase-admin");
const serviceAccount = require("../new-key.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function check() {
    const snap = await db.collection("turni").get();
    console.log(`Numero turni nel DB: ${snap.size}`);
}

check().catch(console.error);
