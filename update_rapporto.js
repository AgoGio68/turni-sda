/**
 * update_rapporto.js
 * Aggiorna SOLO il campo tipoRapporto su Firestore per ogni utente attivo nel CSV.
 * Usa setDoc con merge:true per non toccare is_admin, ruolo, last_active, ecc.
 */
import fs from 'fs';
import csv from 'csv-parser';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAc_ZXW_6QXvG9yHRMxB3dbZEp9X8qTTzg",
  authDomain: "turni-sda.firebaseapp.com",
  projectId: "turni-sda",
  storageBucket: "turni-sda.firebasestorage.app",
  messagingSenderId: "840030023706",
  appId: "1:840030023706:web:1a6f738ed3051075c5a1a3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const updates = new Map();

console.log("Lettura CSV per aggiornamento tipoRapporto...");

fs.createReadStream('dbsocc.csv')
  .pipe(csv({ separator: ';' }))
  .on('data', (data) => {
    if (data.attivo !== 'SI') return;
    const matricola = data.matricola?.trim();
    if (!matricola) return;
    if (!updates.has(matricola)) {
      const tipoRapporto = (data.rapporto && data.rapporto.trim() === 'Dipendente')
        ? 'Dipendente'
        : 'Volontario';
      updates.set(matricola, tipoRapporto);
    }
  })
  .on('end', async () => {
    console.log(`Trovati ${updates.size} utenti attivi. Inizio aggiornamento Firestore...`);
    let ok = 0, err = 0;
    for (const [matricola, tipoRapporto] of updates.entries()) {
      try {
        await setDoc(doc(db, 'utenti', matricola), { tipoRapporto }, { merge: true });
        console.log(`[OK] ${matricola} → ${tipoRapporto}`);
        ok++;
      } catch (e) {
        console.error(`[ERR] ${matricola}: ${e.message}`);
        err++;
      }
    }
    console.log(`\nCompletato: ${ok} OK, ${err} errori.`);
    process.exit(0);
  })
  .on('error', (err) => {
    console.error("Errore lettura CSV:", err);
    process.exit(1);
  });
