import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const slotVuoto = { matricola: null, nominativo: null, convalidato_da_admin: false };

async function run() {
    console.log("=== INIZIO GENERAZIONE TURNI TEST (10 GIU - 31 LUG 2026) ===");

    // 1. Elimina TUTTI i turni esistenti prima di caricare i nuovi
    console.log("Eliminazione di eventuali turni vecchi...");
    const oldShifts = await db.collection('turni').get();
    let batch = db.batch();
    let ops = 0;
    
    for(const doc of oldShifts.docs) {
        batch.delete(doc.ref);
        ops++;
        if(ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if(ops > 0) { await batch.commit(); }
    console.log(`Cancellati ${oldShifts.docs.length} turni obsoleti.`);

    // 2. Generazione turni
    console.log("Generazione nuovi turni vuoti per i test...");
    batch = db.batch();
    ops = 0;
    let creati = 0;

    const getEquipaggioVuoto = () => ({ 
        autista: {...slotVuoto}, 
        referente_soreu: {...slotVuoto}, 
        soccorritore: {...slotVuoto}, 
        allievo_quarto_posto: {...slotVuoto} 
    });

    const startDate = new Date('2026-06-10T00:00:00');
    const endDate = new Date('2026-07-31T23:59:59');

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dataStr = `${yyyy}-${mm}-${dd}`;
        const dayOfWeek = d.getDay(); // 0=Dom ... 6=Sab

        // Calcolo fasce 118 (coerente con la struttura dell'Associazione)
        let fasce = [];
        if (dayOfWeek >= 1 && dayOfWeek <= 4) {
            fasce = [
                { id: 'MATTINA', inizio: '06:00', fine: '13:00' },
                { id: 'POMERIGGIO', inizio: '13:00', fine: '20:00' },
                { id: 'NOTTE', inizio: '20:00', fine: '06:00' }
            ];
        } else if (dayOfWeek === 5) {
            fasce = [
                { id: 'MATTINA', inizio: '06:00', fine: '13:00' },
                { id: 'POMERIGGIO', inizio: '13:00', fine: '20:00' },
                { id: 'NOTTE', inizio: '20:00', fine: '08:00' }
            ];
        } else if (dayOfWeek === 6) {
            fasce = [
                { id: 'MATTINA', inizio: '08:00', fine: '13:00' },
                { id: 'POMERIGGIO', inizio: '13:00', fine: '20:00' },
                { id: 'NOTTE', inizio: '20:00', fine: '08:00' }
            ];
        } else if (dayOfWeek === 0) {
            fasce = [
                { id: 'MATTINA', inizio: '08:00', fine: '13:00' },
                { id: 'POMERIGGIO', inizio: '13:00', fine: '20:00' },
                { id: 'NOTTE', inizio: '20:00', fine: '06:00' }
            ];
        }

        for (const f of fasce) {
            const idTurno = `${yyyy}_${mm}_${dd}_118_${f.id}`;
            const docRef = db.collection('turni').doc(idTurno);
            batch.set(docRef, {
                id_turno: idTurno,
                data: dataStr,
                fascia: f.id,
                orario: { inizio: f.inizio, fine: f.fine },
                tipo_servizio: "EMERGENZA_118",
                stato_turno: "APERTO",
                requisiti_equipaggio: { autista_richiesto: true, referente_richiesto: true, soccorritore_richiesto: true, allievo_consentito: true },
                equipaggio_attuale: getEquipaggioVuoto(),
                log_modifiche: [{ timestamp: new Date().toISOString(), autore: "script_massivo", azione: `Creazione turno 118 ${f.id}`, notifica_inviata: false }]
            });
            ops++; creati++;
            if(ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
    }

    if(ops > 0) { await batch.commit(); }
    console.log(`✅ SUCCESSO! Generati ${creati} nuovi turni vuoti per il periodo 10 Giu - 31 Lug.`);
    process.exit(0);
}

run().catch(err => {
    console.error("Errore durante la generazione:", err);
    process.exit(1);
});
