import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./turni-sda-firebase-adminsdk-fbsvc-7aa3fc5b70.json', 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const messaging = getMessaging();

async function simulate() {
    const msgId = "y1aSwlBuldG9sXUC94cN";
    console.log(`=== SIMULATION FOR MESSAGE ID: ${msgId} ===`);
    
    const snapshot = await db.collection("comunicazioni_turni").doc(msgId).get();
    if (!snapshot.exists) {
        console.error("Document not found!");
        process.exit(1);
    }
    
    const data = snapshot.data();
    console.log("Document data:", JSON.stringify(data, null, 2));
    
    if (!data || !data.notifica || !data.notifica.richiede_push) {
        console.log("No push required.");
        process.exit(0);
    }

    const destinatario = data.destinatario_matricola;
    const titolo = data.notifica.titolo || "Nuovo Messaggio Urgente";
    const testo = data.testo || "Controlla l'applicazione.";

    console.log(`Destinatario: ${destinatario}`);
    console.log(`Titolo: ${titolo}`);
    console.log(`Testo: ${testo}`);

    try {
        let tokens = [];

        if (destinatario === "ALL") {
            const snapshotDispositivi = await db.collection("dispositivi_notifiche").get();
            snapshotDispositivi.forEach(doc => {
                const data = doc.data();
                if (data.token_fcm) {
                    tokens.push(data.token_fcm);
                } else {
                    tokens.push(doc.id);
                }
            });
        } else {
            // 1. Cerca i dispositivi registrati col nuovo formato
            const snapshotDispositivi = await db.collection("dispositivi_notifiche")
                .where("matricola", "==", destinatario)
                .get();
            snapshotDispositivi.forEach(doc => {
                tokens.push(doc.id);
            });

            // 2. Compatibilità con il vecchio formato
            const docDispositivo = await db.collection("dispositivi_notifiche").doc(destinatario).get();
            if (docDispositivo.exists && docDispositivo.data().token_fcm) {
                tokens.push(docDispositivo.data().token_fcm);
            }
        }

        console.log(`Tokens found (${tokens.length}):`, tokens);

        if (tokens.length === 0) {
            console.log("Nessun token registrato trovato per il destinatario:", destinatario);
            process.exit(0);
        }

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

        console.log("Sending multicast payload...");
        const response = await messaging.sendEachForMulticast({
            tokens: tokens,
            notification: payload.notification,
            data: payload.data,
            apns: payload.apns
        });
        
        console.log(`[FCM_SERVER] Success count: ${response.successCount}`);
        console.log(`[FCM_SERVER] Failure count: ${response.failureCount}`);
        response.responses.forEach((res, index) => {
            if (res.success) {
                console.log(`Response ${index}: Success - ID ${res.messageId}`);
            } else {
                console.error(`Response ${index}: Failed - Error code ${res.error.code}: ${res.error.message}`);
            }
        });
    } catch (error) {
        console.error("Simulation error:", error);
    }
    process.exit(0);
}

simulate();
