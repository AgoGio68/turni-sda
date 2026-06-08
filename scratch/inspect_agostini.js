import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
    console.log("=== Querying utenti for Agostini ===");
    const snap = await db.collection("utenti").where("cognome", "==", "Agostini").get();
    snap.docs.forEach(d => {
        console.log(`ID: ${d.id}`);
        console.log(JSON.stringify(d.data(), null, 2));
        console.log("---------------------------------------");
    });
    process.exit(0);
}
run();
