import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, writeBatch } from "firebase/firestore";

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

const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

const formatSlot = (u) => {
    return u 
        ? { matricola: u.matricola, nominativo: `${u.nome} ${u.cognome}`, convalidato_da_admin: true } 
        : { matricola: null, nominativo: null, convalidato_da_admin: false };
};

const slotVuoto = { matricola: null, nominativo: null, convalidato_da_admin: false };

async function run() {
    console.log("=================================================");
    console.log("1. Lettura anagrafiche utenti per simulazione...");
    
    let utenti = [];
    try {
        const snap = await getDocs(collection(db, "utenti"));
        utenti = snap.docs.map(d => d.data());
    } catch (e) {
        console.error("Impossibile leggere la collezione 'utenti'.", e);
        process.exit(1);
    }
    
    // Categorizzazione volontari attivi con SSE (requisito base per 118)
    const autisti = utenti.filter(u => u.attivo && u.abilitazioni_servizi?.sse && (u.ruoli_areu || []).some(r => r.toLowerCase() === 'autista msb'));
    const referenti = utenti.filter(u => u.attivo && u.abilitazioni_servizi?.sse && (u.ruoli_areu || []).some(r => r.toLowerCase() === 'socc. referente per soreu'));
    const soccorritori = utenti.filter(u => u.attivo && u.abilitazioni_servizi?.sse && (u.ruoli_areu || []).some(r => r.toLowerCase() === 'soccorritore'));

    console.log(`   Trovati ${utenti.length} utenti totali.`);
    console.log(`   Pool validi: ${autisti.length} Autisti, ${referenti.length} Referenti, ${soccorritori.length} Soccorritori.`);
    console.log("=================================================");

    // Date range
    const startDate = new Date('2026-05-29T12:00:00Z');
    const endDate = new Date('2026-06-30T12:00:00Z');
    
    const batch = writeBatch(db);
    let count = 0;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dataStr = `${yyyy}-${mm}-${dd}`;
        const dayOfWeek = d.getDay(); // 0=Dom, 1=Lun ... 6=Sab
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        console.log(`[+] Caricato giorno ${dataStr}`);

        // Helper per simulare un equipaggio parzialmente occupato (40% dei casi)
        const get118Equipaggio = () => {
            const eq = { 
                autista: {...slotVuoto}, 
                referente_soreu: {...slotVuoto}, 
                soccorritore: {...slotVuoto}, 
                allievo_quarto_posto: {...slotVuoto} 
            };
            
            if (Math.random() < 0.4) {
                if (Math.random() > 0.3 && autisti.length > 0) eq.autista = formatSlot(getRandomItem(autisti));
                if (Math.random() > 0.4 && referenti.length > 0) eq.referente_soreu = formatSlot(getRandomItem(referenti));
                if (Math.random() > 0.2 && soccorritori.length > 0) eq.soccorritore = formatSlot(getRandomItem(soccorritori));
            }
            return eq;
        };

        // 1. DIURNO 118 (Tutti i giorni)
        const idDiurno = `${yyyy}_${mm}_${dd}_118_DIURNO`;
        batch.set(doc(db, "turni", idDiurno), {
            id_turno: idDiurno,
            data: dataStr,
            orario: { inizio: "08:00", fine: "20:00" },
            tipo_servizio: "EMERGENZA_118",
            stato_turno: "APERTO",
            requisiti_equipaggio: { autista_richiesto: true, referente_richiesto: true, soccorritore_richiesto: true, allievo_consentito: true },
            equipaggio_attuale: get118Equipaggio(),
            log_modifiche: [{ timestamp: new Date().toISOString(), autore: "script_massivo", azione: "Generazione batch pre-compilata", notifica_inviata: false }]
        });
        count++;

        // 2. NOTTURNO 118 (Tutti i giorni)
        const idNotturno = `${yyyy}_${mm}_${dd}_118_NOTTURNO`;
        batch.set(doc(db, "turni", idNotturno), {
            id_turno: idNotturno,
            data: dataStr,
            orario: { inizio: "20:00", fine: "08:00" },
            tipo_servizio: "EMERGENZA_118",
            stato_turno: "APERTO",
            requisiti_equipaggio: { autista_richiesto: true, referente_richiesto: true, soccorritore_richiesto: true, allievo_consentito: true },
            equipaggio_attuale: get118Equipaggio(),
            log_modifiche: [{ timestamp: new Date().toISOString(), autore: "script_massivo", azione: "Generazione batch pre-compilata", notifica_inviata: false }]
        });
        count++;

        // 3. TS MATTINA (Solo da Lun a Ven)
        if (!isWeekend) {
            const idTs = `${yyyy}_${mm}_${dd}_TS_MATTINA`;
            batch.set(doc(db, "turni", idTs), {
                id_turno: idTs,
                data: dataStr,
                orario: { inizio: "07:00", fine: "13:00" },
                tipo_servizio: "TRASPORTO_SANITARIO",
                stato_turno: "APERTO",
                requisiti_equipaggio: { autista_richiesto: true, referente_richiesto: false, soccorritore_richiesto: true, allievo_consentito: false },
                equipaggio_attuale: { autista: {...slotVuoto}, referente_soreu: {...slotVuoto}, soccorritore: {...slotVuoto}, allievo_quarto_posto: {...slotVuoto} },
                log_modifiche: [{ timestamp: new Date().toISOString(), autore: "script_massivo", azione: "Generazione batch TS", notifica_inviata: false }]
            });
            count++;
        }


    }

    console.log("=================================================");
    console.log(`Sto eseguendo l'invio massivo al cloud per ${count} documenti...`);
    
    try {
        await batch.commit();
        console.log(`✅ SUCCESSO! Generazione completata e chiusura processo.`);
    } catch (err) {
        console.error("❌ ERRORE durante il commit del batch su Firestore:", err);
    }
    
    process.exit(0);
}

run();
