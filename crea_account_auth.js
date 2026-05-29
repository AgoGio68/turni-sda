import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

// Assicurati di avere il file serviceAccountKey.json nella stessa cartella 
// (puoi generarlo dalle impostazioni del progetto in Firebase Console > Account di servizio)
const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

async function creaAccountAuth() {
  console.log("Inizio allineamento account Auth con Firestore...");
  let creati = 0;
  
  try {
    const snapshot = await db.collection('utenti').get();
    
    for (const doc of snapshot.docs) {
      const userData = doc.data();
      const matricola = userData.matricola || doc.id;
      const email = `${matricola}@turni-sda.local`;
      
      try {
        await auth.getUserByEmail(email);
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          try {
            await auth.createUser({
              uid: String(matricola),
              email: email,
              password: 'soccorso2026',
              displayName: `${userData.nome || ''} ${userData.cognome || ''}`.trim()
            });
            creati++;
            console.log(`Creato account Auth per matricola ${matricola} (${email})`);
          } catch (createErr) {
            console.error(`Errore creazione account Auth per matricola ${matricola}:`, createErr.message);
          }
        } else {
          console.error(`Errore recupero account per matricola ${matricola}:`, error.message);
        }
      }
    }
    
    console.log(`Allineamento terminato con successo. Creati ${creati} nuovi account Auth.`);
    process.exit(0);
  } catch (err) {
    console.error("Errore irreversibile durante la lettura da Firestore:", err);
    process.exit(1);
  }
}

creaAccountAuth();
