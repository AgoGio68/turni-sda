import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();

const KIOSK_EMAIL = 'kiosk@turni-sda.local';
const KIOSK_PASSWORD = 'kiosk2026';
const KIOSK_TOKEN = 'SDA-KIOSK-2026';

async function run() {
    // 1. Crea l'account Firebase Auth per il kiosk
    try {
        await auth.getUserByEmail(KIOSK_EMAIL);
        console.log('[AUTH] ℹ Utente kiosk già esistente.');
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            await auth.createUser({
                email: KIOSK_EMAIL,
                password: KIOSK_PASSWORD,
                displayName: 'Kiosk Tabellone'
            });
            console.log('[AUTH] ✓ Utente kiosk creato.');
        } else {
            throw e;
        }
    }

    // 2. Crea il documento Firestore con il token di verifica
    await db.collection('utenti').doc('kiosk').set({
        matricola: 'kiosk',
        nome: 'Tabellone',
        cognome: 'Kiosk',
        is_kiosk: true,
        is_admin: false,
        kiosk_token: KIOSK_TOKEN,
        ruoli_areu: [],
        abilitazioni_servizi: { sse: false, tss: false, ts: false }
    }, { merge: true });

    console.log('[FIRESTORE] ✓ Documento utenti/kiosk creato con token:', KIOSK_TOKEN);
    console.log('');
    console.log('============================================');
    console.log('Magic Link per il Tabellone:');
    console.log(`https://turni-sda.web.app/?kiosk=${KIOSK_TOKEN}`);
    console.log('============================================');
    process.exit(0);
}

run();
