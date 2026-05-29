import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
    console.log("Ricerca turni TRASPORTO_SANITARIO...");
    const tsShifts = await db.collection('turni').where('tipo_servizio', '==', 'TRASPORTO_SANITARIO').get();
    
    let batch = db.batch();
    let count = 0;
    
    for (const doc of tsShifts.docs) {
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
    
    console.log(`Cancellati con successo ${count} turni di TRASPORTO_SANITARIO.`);
    process.exit(0);
}

run();
