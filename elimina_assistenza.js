import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
    const vecchi = await db.collection('turni').where('tipo_servizio', '==', 'ASSISTENZA_EVENTI').get();
    let batch = db.batch();
    let count = 0;
    for (const doc of vecchi.docs) {
        batch.delete(doc.ref);
        count++;
        if (count % 400 === 0) {
            await batch.commit();
            batch = db.batch();
        }
    }
    if (count % 400 !== 0) {
        await batch.commit();
    }
    console.log(`Cancellati ${count} turni di ASSISTENZA_EVENTI (orari 14:00 - 19:00).`);
    process.exit(0);
}
run();
