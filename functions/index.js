const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

if (!admin.apps.length) {
    admin.initializeApp();
}

// Imposta le opzioni globali per la Gen 2 (regione europea compatibile con eur3)
setGlobalOptions({ region: "europe-west1" });

exports.inviaNotificaPushEmergenza = onDocumentCreated("comunicazioni_turni/{idMessaggio}", async (event) => {
    // In Gen 2, il DocumentSnapshot è disponibile dentro event.data
    const snapshot = event.data;
    if (!snapshot) return null;
    
    const data = snapshot.data();
    
    // Controlla se il messaggio richiede esplicitamente l'invio push
    if (!data || !data.notifica || !data.notifica.richiede_push) {
        return null;
    }

    const destinatario = data.destinatario_matricola;
    const titolo = data.notifica.titolo || "Nuovo Messaggio Urgente";
    const testo = data.testo || "Controlla l'applicazione.";

    try {
        let tokens = [];

        if (destinatario === "ALL") {
            // Invia a tutti i dispositivi registrati
            const snapshotDispositivi = await admin.firestore().collection("dispositivi_notifiche").get();
            snapshotDispositivi.forEach(doc => {
                const data = doc.data();
                if (data.token_fcm) {
                    tokens.push(data.token_fcm);
                } else {
                    tokens.push(doc.id);
                }
            });
        } else {
            // 1. Cerca i dispositivi registrati col nuovo formato (ID documento = token, matricola come campo)
            const snapshotDispositivi = await admin.firestore()
                .collection("dispositivi_notifiche")
                .where("matricola", "==", destinatario)
                .get();
            snapshotDispositivi.forEach(doc => {
                tokens.push(doc.id);
            });

            // 2. Compatibilità con il vecchio formato (ID documento = matricola, token_fcm come campo)
            const docDispositivo = await admin.firestore().collection("dispositivi_notifiche").doc(destinatario).get();
            if (docDispositivo.exists && docDispositivo.data().token_fcm) {
                tokens.push(docDispositivo.data().token_fcm);
            }
        }

        if (tokens.length === 0) {
            console.log("Nessun token registrato trovato per il destinatario:", destinatario);
            return null;
        }

        // Payload nativo strutturato esattamente per attivare popup e suono su Android/iOS/Web
        const payload = {
            notification: {
                title: titolo,
                body: testo,
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default"
                    }
                }
            },
            webpush: {
                headers: {
                    Urgency: "high"
                },
                notification: {
                    title: titolo,
                    body: testo,
                    icon: "/assets/icons/icon-192x192.png",
                    badge: "/assets/icons/icon-72x72.png",
                    requireInteraction: true
                }
            },
            data: {
                title: titolo,
                body: testo,
                click_action: "FLUTTER_NOTIFICATION_CLICK"
            }
        };

        // Invia il pacchetto push a tutti i dispositivi estratti
        const response = await admin.messaging().sendEachForMulticast({
            tokens: tokens,
            notification: payload.notification,
            data: payload.data,
            apns: payload.apns,
            webpush: payload.webpush
        });
        
        console.log(`[FCM_SERVER] Inviati con successo ${response.successCount} messaggi push su ${tokens.length}.`);
        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.warn(`[FCM_SERVER] Errore invio a token ${tokens[idx]}:`, resp.error);
                    const errorCode = resp.error?.code;
                    if (errorCode === 'messaging/registration-token-not-registered' || errorCode === 'messaging/invalid-registration-token') {
                        console.log(`[FCM_SERVER] Token non valido, rimozione documento: ${tokens[idx]}`);
                        admin.firestore().collection('dispositivi_notifiche').doc(tokens[idx]).delete().catch(delErr => {
                            console.error(`[FCM_SERVER] Errore durante la rimozione del token ${tokens[idx]}:`, delErr);
                        });
                    }
                }
            });
        }
        return null;
    } catch (error) {
        console.error("[FCM_SERVER_ERROR] Errore durante l'invio del push:", error);
        return null;
    }
});

exports.inviaReminderTurni = onSchedule({
    schedule: "0 9 * * *", // Esegui ogni giorno alle 09:00
    timeZone: "Europe/Rome"
}, async (event) => {
    const db = admin.firestore();
    
    let giorniPreavvisoReminder = 1;
    try {
        const configSnap = await db.collection("impostazioni").doc("regole_riposo").get();
        if (configSnap.exists) {
            const configData = configSnap.data();
            if (configData.giorniPreavvisoReminder !== undefined) {
                giorniPreavvisoReminder = parseInt(configData.giorniPreavvisoReminder, 10) || 1;
            }
        }
    } catch (configErr) {
        console.error("[REMINDER] Errore caricamento configurazione giorniPreavvisoReminder:", configErr);
    }
    
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + giorniPreavvisoReminder);
    
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const domaniStr = formatter.format(targetDate);
    
    let dataTurnoFmt = domaniStr;
    try {
        const parts = domaniStr.split('-');
        if (parts.length === 3) {
            dataTurnoFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    } catch (e) {}

    const tempoprimatesto = giorniPreavvisoReminder === 1 ? "Domani" : `il giorno ${dataTurnoFmt}`;
    const titoloNotifica = giorniPreavvisoReminder === 1 ? "Promemoria Turno di Domani" : `Promemoria Turno del ${dataTurnoFmt}`;
    
    console.log(`[REMINDER] Avvio controllo turni per ${tempoprimatesto} (${domaniStr}) - giorni preavviso: ${giorniPreavvisoReminder}`);
    
    try {
        const turniSnap = await db.collection("turni").where("data", "==", domaniStr).get();
        if (turniSnap.empty) {
            console.log(`[REMINDER] Nessun turno trovato per ${domaniStr}`);
            return null;
        }
        
        // REFACTORING-06: Pre-fetch all existing reminders in bulk instead of N+1 queries
        const turnoIds = turniSnap.docs.map(d => d.id);
        const sentReminderKeys = new Set();
        
        // Firestore 'in' operator supports max 30 values, so chunk if needed
        for (let i = 0; i < turnoIds.length; i += 30) {
            const chunk = turnoIds.slice(i, i + 30);
            const existingSnap = await db.collection('comunicazioni_turni')
                .where('tipo', '==', 'reminder_turno')
                .where('turno_id', 'in', chunk)
                .get();
            existingSnap.forEach(doc => {
                const d = doc.data();
                if (d.destinatario_matricola && d.turno_id) {
                    sentReminderKeys.add(`${d.destinatario_matricola}_${d.turno_id}`);
                }
            });
        }
        
        const promises = [];
        
        for (const docSnap of turniSnap.docs) {
            const turnoData = docSnap.data();
            const turnoId = docSnap.id;
            const equipaggio = turnoData.equipaggio_attuale || {};
            const tipoServizio = (turnoData.tipo_servizio || "").replace(/_/g, " ");
            
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
                        
                        const reminderKey = `${matricola}_${turnoId}`;
                        if (sentReminderKeys.has(reminderKey)) {
                            console.log(`[REMINDER] Reminder già inviato in precedenza a ${nominativo} (${matricola}) per il turno ${turnoId}`);
                            continue;
                        }
                        
                        console.log(`[REMINDER] Invio promemoria a ${nominativo} (${matricola}) per il turno del ${domaniStr}`);
                        
                        const msgRef = db.collection("comunicazioni_turni").doc();
                        const msgPayload = {
                            mittente_matricola: "SYSTEM",
                            destinatario_matricola: matricola,
                            testo: `Promemoria: ${tempoprimatesto} (${dataTurnoFmt}) hai il turno "${tipoServizio}" dalle ${orarioInizio} alle ${orarioFine} come ${ruolo.replace(/_/g, " ").toUpperCase()}.`,
                            tipo: "reminder_turno",
                            timestamp: new Date().toISOString(),
                            letto: false,
                            turno_id: turnoId,
                            notifica: {
                                richiede_push: true,
                                urgente: false,
                                suono: "default",
                                titolo: titoloNotifica
                            }
                        };
                        
                        promises.push(msgRef.set(msgPayload));
                    }
                }
            }
        }
        
        if (promises.length > 0) {
            await Promise.all(promises);
            console.log(`[REMINDER] Inviati con successo ${promises.length} reminder.`);
        } else {
            console.log("[REMINDER] Nessun nuovo reminder da inviare.");
        }
        
        return null;
    } catch (error) {
        console.error("[REMINDER_ERROR] Errore durante l'invio dei reminder:", error);
        return null;
    }
});
