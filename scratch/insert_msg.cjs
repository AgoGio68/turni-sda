const admin = require("firebase-admin");
const serviceAccount = require("../turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function run() {
    const payload = {
        mittente_matricola: "admin_test",
        destinatario_matricola: "034",
        testo: "Messaggio di test per debug push notification!",
        tipo: "comunicazione_generica",
        timestamp: new Date().toISOString(),
        letto: false,
        notifica: {
            richiede_push: true,
            urgente: true,
            suono: "default",
            titolo: "Test Push Antigravity"
        }
    };

    console.log("Inserimento documento in comunicazioni_turni...");
    const docRef = await db.collection("comunicazioni_turni").add(payload);
    console.log("Documento inserito con ID:", docRef.id);
}

run().catch(console.error);
