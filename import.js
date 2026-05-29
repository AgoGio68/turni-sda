import fs from 'fs';
import csv from 'csv-parser';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
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
const auth = getAuth(app);
const db = getFirestore(app);

const utentiMap = new Map();

console.log("Inizio lettura e filtraggio del file dbsocc.csv...");

fs.createReadStream('dbsocc.csv')
  .pipe(csv({ separator: ';' }))
  .on('data', (data) => {
    if (data.attivo !== 'SI') {
      return;
    }

    const matricola = data.matricola;
    if (!matricola) return;

    if (!utentiMap.has(matricola)) {
      utentiMap.set(matricola, {
        matricola: matricola,
        cognome: data.cognome || "",
        nome: data.nome || "",
        cod_fiscale: data.cod_fiscale || "",
        email_fittizia: `${matricola}@turni-sda.local`,
        ruoli_areu: new Set(),
        abilitazioni_servizi: { sse: false, tss: false, ts: false },
        scadenze: { 
          dtscad120: data.dtscad120 || "", 
          dtscaddae: data.dtscaddae || "" 
        },
        override_admin: { qualifica_manuale: "", note: "" }
      });
    }

    const utente = utentiMap.get(matricola);

    if (data.mansione) {
      utente.ruoli_areu.add(data.mansione);
    }

    if (data.sse === 'SI') {
      utente.abilitazioni_servizi.sse = true;
      utente.abilitazioni_servizi.ts = true;
      utente.abilitazioni_servizi.tss = true;
    } else if (data.sse === 'NO') {
      if (data.ts === 'SI') utente.abilitazioni_servizi.ts = true;
      if (data.tss === 'SI') utente.abilitazioni_servizi.tss = true;
    }
  })
  .on('end', async () => {
    console.log(`Lettura completata. Elaborazione di ${utentiMap.size} utenti unici attivi.`);
    console.log("Inizio importazione in Firebase Auth e Firestore...");

    let successCount = 0;
    let errorCount = 0;

    for (const [matricola, userData] of utentiMap.entries()) {
      const finalUserData = {
        ...userData,
        ruoli_areu: Array.from(userData.ruoli_areu)
      };

      const password = "soccorso2026";

      try {
        try {
          await createUserWithEmailAndPassword(auth, finalUserData.email_fittizia, password);
          console.log(`[AUTH] ✓ Utente creato: ${matricola}`);
        } catch (authError) {
          if (authError.code === 'auth/email-already-in-use') {
            console.log(`[AUTH] ℹ Utente già esistente: ${matricola}`);
          } else {
            throw authError; 
          }
        }

        const docRef = doc(db, 'utenti', matricola);
        await setDoc(docRef, finalUserData);
        console.log(`[FIRESTORE] ✓ Documento salvato: ${matricola}`);

        successCount++;
      } catch (error) {
        console.error(`[ERRORE] ✗ Matricola ${matricola}: ${error.message}`);
        errorCount++;
      }
    }

    console.log("======================================");
    console.log(`Importazione completata!`);
    console.log(`Successi: ${successCount}`);
    console.log(`Errori: ${errorCount}`);
    console.log("======================================");
    process.exit(0);
  })
  .on('error', (err) => {
    console.error("Errore critico durante la lettura del file CSV:", err);
    process.exit(1);
  });
