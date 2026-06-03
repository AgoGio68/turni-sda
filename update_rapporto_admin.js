/**
 * update_rapporto_admin.js
 * Aggiorna SOLO il campo tipoRapporto usando Firebase Admin SDK (bypassa le security rules).
 * Usa merge:true — non tocca is_admin, ruolo, last_active, ecc.
 */
import fs from 'fs';
import csv from 'csv-parser';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
const serviceAccount = require('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const updates = new Map();

console.log("Lettura CSV per aggiornamento tipoRapporto (Admin SDK)...");

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
    console.log(`Trovati ${updates.size} utenti attivi. Avvio aggiornamento Firestore...`);
    let ok = 0, err = 0;
    for (const [matricola, tipoRapporto] of updates.entries()) {
      try {
        await db.collection('utenti').doc(matricola).set({ tipoRapporto }, { merge: true });
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
