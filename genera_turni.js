import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const slotVuoto = { matricola: null, nominativo: null, convalidato_da_admin: false };

async function run() {
    console.log("Inizio generazione nuovi turni...");

    // 1. Elimino i vecchi turni dal giorno corrente in poi
    const startDate = new Date();
    startDate.setHours(0,0,0,0);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 2); // Genera per i prossimi 2 mesi

    const dataStartStr = startDate.toISOString().split('T')[0];
    console.log(`Eliminazione turni vecchi a partire dal ${dataStartStr}...`);
    
    const oldShifts = await db.collection('turni').where('data', '>=', dataStartStr).get();
    let batch = db.batch();
    let ops = 0;
    
    for(const doc of oldShifts.docs) {
        batch.delete(doc.ref);
        ops++;
        if(ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if(ops > 0) { await batch.commit(); }
    console.log(`Cancellati ${oldShifts.docs.length} turni obsoleti.`);

    console.log("Generazione nuovi turni con struttura 118 dinamica...");
    batch = db.batch();
    ops = 0;
    let creati = 0;

    const getEquipaggioVuoto = () => ({ 
        autista: {...slotVuoto}, 
        referente_soreu: {...slotVuoto}, 
        soccorritore: {...slotVuoto}, 
        allievo_quarto_posto: {...slotVuoto} 
    });

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dataStr = `${yyyy}-${mm}-${dd}`;
        const dayOfWeek = d.getDay(); // 0=Dom ... 6=Sab
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // CALCOLO FASCE 118
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

        // TS MATTINA (Solo da Lun a Ven)
        if (!isWeekend) {
            const idTs = `${yyyy}_${mm}_${dd}_TS_MATTINA`;
            batch.set(db.collection('turni').doc(idTs), {
                id_turno: idTs,
                data: dataStr,
                fascia: 'MATTINA',
                orario: { inizio: "07:00", fine: "13:00" },
                tipo_servizio: "TRASPORTO_SANITARIO",
                stato_turno: "APERTO",
                requisiti_equipaggio: { autista_richiesto: true, referente_richiesto: false, soccorritore_richiesto: true, allievo_consentito: false },
                equipaggio_attuale: getEquipaggioVuoto(),
                log_modifiche: [{ timestamp: new Date().toISOString(), autore: "script_massivo", azione: "Creazione TS", notifica_inviata: false }]
            });
            ops++; creati++;
            if(ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }

        // ASSISTENZA EVENTI (Solo Sab e Dom)
        if (isWeekend) {
            const idAssistenza = `${yyyy}_${mm}_${dd}_ASSISTENZA`;
            batch.set(db.collection('turni').doc(idAssistenza), {
                id_turno: idAssistenza,
                data: dataStr,
                fascia: 'POMERIGGIO',
                orario: { inizio: "14:00", fine: "19:00" },
                tipo_servizio: "ASSISTENZA_EVENTI",
                stato_turno: "APERTO",
                requisiti_equipaggio: { autista_richiesto: true, referente_richiesto: true, soccorritore_richiesto: true, allievo_consentito: false },
                equipaggio_attuale: getEquipaggioVuoto(),
                log_modifiche: [{ timestamp: new Date().toISOString(), autore: "script_massivo", azione: "Creazione Eventi", notifica_inviata: false }]
            });
            ops++; creati++;
            if(ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
        }
    }

    if(ops > 0) { await batch.commit(); }
    console.log(`✅ SUCCESSO! Generati ${creati} nuovi turni correttamente.`);
    process.exit(0);
}

run();
