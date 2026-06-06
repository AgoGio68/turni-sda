const { onDocumentCreated } = require("firebase-functions/v2/firestore");
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
                if (doc.data().token_fcm) tokens.push(doc.data().token_fcm);
            });
        } else {
            // Recupera il token specifico della matricola destinataria
            const docDispositivo = await admin.firestore().collection("dispositivi_notifiche").doc(destinatario).get();
            if (docDispositivo.exists && docDispositivo.data().token_fcm) {
                tokens.push(docDispositivo.data().token_fcm);
            }
        }

        if (tokens.length === 0) {
            console.log("Nessun token registrato trovato per il destinatario:", destinatario);
            return null;
        }

        // Payload nativo strutturato esattamente per attivare popup e suono su Android/iOS
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
            apns: payload.apns
        });
        
        console.log(`[FCM_SERVER] Inviati con successo ${response.successCount} messaggi push.`);
        return null;
    } catch (error) {
        console.error("[FCM_SERVER_ERROR] Errore durante l'invio del push:", error);
        return null;
    }
});
