import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function testReminder() {
    let giorniPreavvisoReminder = 1;
    let domaniStr = process.argv[2];
    
    // Carichiamo sempre le impostazioni per mostrare il valore corretto
    try {
        const configSnap = await db.collection("impostazioni").doc("regole_riposo").get();
        if (configSnap.exists) {
            const configData = configSnap.data();
            if (configData.giorniPreavvisoReminder !== undefined) {
                giorniPreavvisoReminder = parseInt(configData.giorniPreavvisoReminder, 10) || 1;
            }
        }
    } catch (configErr) {
        console.error("Errore caricamento impostazioni giorni preavviso:", configErr);
    }

    if (!domaniStr) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + giorniPreavvisoReminder);
        
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Europe/Rome',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        domaniStr = formatter.format(targetDate);
        console.log(`Preavviso impostato a: ${giorniPreavvisoReminder} giorni.`);
    }
    
    console.log(`=== TEST REMINDER PER LA DATA: ${domaniStr} ===`);
    
    try {
        const turniSnap = await db.collection("turni").where("data", "==", domaniStr).get();
        if (turniSnap.empty) {
            console.log(`Nessun turno trovato per la data (${domaniStr})`);
            process.exit(0);
        }
        
        console.log(`Trovati ${turniSnap.docs.length} turni.`);
        
        for (const docSnap of turniSnap.docs) {
            const turnoData = docSnap.data();
            const turnoId = docSnap.id;
            const equipaggio = turnoData.equipaggio_attuale || {};
            const tipoServizio = (turnoData.tipo_servizio || "").replace(/_/g, " ");
            
            console.log(`\nTurno ID: ${turnoId} (${tipoServizio})`);
            
            const ruoli = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'];
            for (const ruolo of ruoli) {
                const assegnati = equipaggio[ruolo] || [];
                const assegnatiArr = Array.isArray(assegnati) ? assegnati : Object.values(assegnati);
                
                for (const vol of assegnatiArr) {
                    if (vol && vol.matricola) {
                        const matricola = String(vol.matricola).trim();
                        const nominativo = String(vol.nominativo).trim();
                        const orarioInizio = vol.inizio || turnoData.orario?.inizio || "08:00";
                        const orarioFine = vol.fine || turnoData.orario?.fine || "14:00";
                        
                        console.log(`  - Volontario: ${nominativo} (${matricola}) in ruolo ${ruolo} (${orarioInizio}-${orarioFine})`);
                        
                        const checkMsg = await db.collection("comunicazioni_turni")
                            .where("destinatario_matricola", "==", matricola)
                            .where("tipo", "==", "reminder_turno")
                            .where("turno_id", "==", turnoId)
                            .get();
                            
                        if (!checkMsg.empty) {
                            console.log(`    ⚠️ Reminder già inviato in precedenza.`);
                            continue;
                        }
                        
                        let dataTurnoFmt = domaniStr;
                        try {
                            const parts = domaniStr.split('-');
                            if (parts.length === 3) {
                                dataTurnoFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
                            }
                        } catch (e) {}
                        const tempoprimatesto = giorniPreavvisoReminder === 1 ? "Domani" : `il giorno ${dataTurnoFmt}`;
                        console.log(`    ✅ Da inviare: "Promemoria: ${tempoprimatesto} (${dataTurnoFmt}) hai il turno '${tipoServizio}' dalle ${orarioInizio} alle ${orarioFine} come ${ruolo.toUpperCase()}."`);
                    }
                }
            }
        }
    } catch (error) {
        console.error("Errore durante il test:", error);
    }
    process.exit(0);
}

testReminder();
