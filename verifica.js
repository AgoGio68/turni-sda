import fs from 'fs';
import csv from 'csv-parser';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

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

let totaleRighe = 0;
let righeScartate = 0;
const utentiCsvUnici = new Map();

console.log("=== 1. VERIFICA LOCALE DEL CSV ===");

fs.createReadStream('dbsocc.csv')
  .pipe(csv({ separator: ';' }))
  .on('data', (data) => {
    totaleRighe++;
    
    if (data.attivo !== 'SI' || !data.matricola) {
      righeScartate++;
      return;
    }

    const matricola = data.matricola;
    
    if (!utentiCsvUnici.has(matricola)) {
      utentiCsvUnici.set(matricola, {
        nome: data.nome,
        cognome: data.cognome,
        ruoli_areu: new Set(),
        sse: false,
        ts: false,
        tss: false
      });
    }

    const u = utentiCsvUnici.get(matricola);
    if (data.mansione) {
      u.ruoli_areu.add(data.mansione.trim().toLowerCase()); // normalizzazione base
    }
    
  })
  .on('end', async () => {
    console.log(`- Righe totali nel file: ${totaleRighe}`);
    console.log(`- Righe scartate (inattivi o senza matricola): ${righeScartate}`);
    console.log(`- Utenti unici attivi attesi in database: ${utentiCsvUnici.size}`);

    console.log("\n=== 2. VERIFICA SU CLOUD FIRESTORE ===");
    console.log("Scaricamento documenti dalla collezione 'utenti'...");
    
    try {
      const querySnapshot = await getDocs(collection(db, "utenti"));
      const dbUtentiMap = new Map();
      
      querySnapshot.forEach((doc) => {
        dbUtentiMap.set(doc.id, doc.data());
      });

      console.log(`- Documenti trovati su Firestore: ${dbUtentiMap.size}`);

      console.log("\n=== 3. VERIFICA INTEGRITÀ PROFILI CHIAVE ===");
      
      let problemi = 0;
      
      // Cerca Giorgio Agostini (ignorando case)
      let matricolaGiorgio = null;
      for (const [mat, data] of dbUtentiMap.entries()) {
        if (data.nome?.toLowerCase() === "giorgio" && data.cognome?.toLowerCase() === "agostini") {
          matricolaGiorgio = mat;
          break;
        }
      }

      if (matricolaGiorgio) {
        const docGiorgio = dbUtentiMap.get(matricolaGiorgio);
        const expectedGiorgio = utentiCsvUnici.get(matricolaGiorgio);
        
        let ruoliCorretti = true;
        if (expectedGiorgio) {
            for (const ruolo of expectedGiorgio.ruoli_areu) {
                // Controllo flessibile nel caso ci siano differenze di case
                if (!docGiorgio.ruoli_areu.some(r => r.toLowerCase() === ruolo)) {
                    ruoliCorretti = false;
                }
            }
        }

        const ab = docGiorgio.abilitazioni_servizi;
        const flagsCorretti = ab && ab.sse === true && ab.ts === true && ab.tss === true;
        
        console.log(`- Agostini Giorgio (Matricola ${matricolaGiorgio}):`);
        console.log(`  > Ruoli accorpati correttamente: ${ruoliCorretti ? 'SI' : 'NO'}`);
        console.log(`  > Flag abilitazioni (sse, ts, tss) tutti true: ${flagsCorretti ? 'SI' : 'NO'}`);
        if (!ruoliCorretti || !flagsCorretti) problemi++;
      } else {
        console.log(`- Agostini Giorgio: NON TROVATO IN FIRESTORE!`);
        problemi++;
      }

      // Controllo Matricola 287 (Agostini Elisa)
      const elisa = dbUtentiMap.get("287");
      if (elisa) {
        const ab = elisa.abilitazioni_servizi;
        const flagsCorretti = ab && ab.sse === true && ab.ts === true && ab.tss === true;
        console.log(`- Agostini Elisa (Matricola 287):`);
        console.log(`  > Override SSE applicato, tutti i flag a true: ${flagsCorretti ? 'SI' : 'NO'}`);
        if (!flagsCorretti) problemi++;
      } else {
        console.log(`- Agostini Elisa (Matricola 287): NON TROVATA IN FIRESTORE!`);
        problemi++;
      }

      // Controllo Matricola 326 (Belingheri Giorgia)
      const giorgia = dbUtentiMap.get("326");
      if (giorgia) {
        const haAllievo = giorgia.ruoli_areu.some(r => r.toLowerCase() === 'allievo/a' || r.toLowerCase() === 'allievo' || r.toLowerCase() === 'allieva');
        console.log(`- Belingheri Giorgia (Matricola 326):`);
        console.log(`  > Presente con ruolo 'allievo/a': ${haAllievo ? 'SI' : 'NO'}`);
        if (!haAllievo) problemi++;
      } else {
        console.log(`- Belingheri Giorgia (Matricola 326): NON TROVATA IN FIRESTORE!`);
        problemi++;
      }

      console.log("\n=== REPORT FINALE ===");
      
      const missingInDb = [];
      for (const mat of utentiCsvUnici.keys()) {
        if (!dbUtentiMap.has(mat)) {
          missingInDb.push(mat);
        }
      }

      if (dbUtentiMap.size === utentiCsvUnici.size && missingInDb.length === 0 && problemi === 0) {
        console.log("VERIFICA SUPERATA: Il database è integro.");
      } else {
        console.log("VERIFICA FALLITA: Sono stati riscontrati dei problemi.");
        if (dbUtentiMap.size !== utentiCsvUnici.size) {
            console.log(`  ! Incongruenza numerica: CSV ha ${utentiCsvUnici.size} utenti, Firestore ne ha ${dbUtentiMap.size}`);
        }
        if (missingInDb.length > 0) {
            console.log(`  ! Matricole mancanti su Firestore: ${missingInDb.join(', ')}`);
        }
        if (problemi > 0) {
            console.log(`  ! Trovati ${problemi} problemi di integrità nei profili chiave controllati sopra.`);
        }
      }

      process.exit(0);

    } catch (error) {
      console.error("Errore durante la query su Firestore:", error);
      process.exit(1);
    }
  })
  .on('error', (err) => {
    console.error("Errore durante la lettura del file CSV:", err);
    process.exit(1);
  });
