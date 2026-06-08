import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
    console.log("=== Querying turni for 2026-06-10 ===");
    const snap = await db.collection("turni").where("data", "==", "2026-06-10").get();
    snap.docs.forEach(d => {
        console.log(`ID: ${d.id}`);
        console.log(JSON.stringify(d.data(), null, 2));
        console.log("---------------------------------------");
    });
    process.exit(0);
}
run();
