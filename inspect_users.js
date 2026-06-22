import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
    console.log("Fetching availability...");
    const snap = await db.collection("disponibilita").get();
    snap.docs.forEach(d => {
        console.log("Availability:", d.id, d.data());
    });
    process.exit(0);
}
run();
