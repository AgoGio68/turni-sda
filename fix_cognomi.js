import fs from 'fs';
import csv from 'csv-parser';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import stripBomStream from 'strip-bom-stream';

// Inizializza admin SDK
const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

console.log("Inizio lettura file dbsocc.csv per recupero cognomi...");

const updatePromises = [];
let count = 0;

fs.createReadStream('dbsocc.csv')
  .pipe(stripBomStream())
  .pipe(csv({ separator: ';' }))
  .on('data', (data) => {
    const matricola = data.matricola;
    if (!matricola) return;

    const cognome = (data.cognome || "").trim();
    const nome = (data.nome || "").trim();

    if (cognome && nome) {
        // Prepariamo l'aggiornamento
        const docRef = db.collection('utenti').doc(matricola);
        const promise = docRef.update({
            cognome: cognome,
            nome: nome
        }).then(() => {
            count++;
            console.log(`Aggiornato utente ${matricola}: ${cognome} ${nome}`);
        }).catch(err => {
            if (err.code !== 5) { // ignora NOT_FOUND
                console.error(`Errore aggiornamento ${matricola}:`, err);
            }
        });
        
        updatePromises.push(promise);
    }
  })
  .on('end', async () => {
    await Promise.allSettled(updatePromises);
    console.log(`Completato! Aggiornati ${count} utenti in Firestore.`);
    process.exit(0);
  });
