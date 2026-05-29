import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc } from "firebase/firestore";

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

function getDateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

const slotVuoto = { matricola: null, nominativo: null, convalidato_da_admin: false };

// 1. TURNO EMERGENZA 118 (Domani)
const turno118Domani = {
  id_turno: "TURNO_TEST_118_DOMANI",
  data: getDateOffset(1),
  orario: { inizio: "08:00", fine: "20:00" },
  tipo_servizio: "EMERGENZA_118",
  stato_turno: "APERTO",
  requisiti_equipaggio: {
    autista_richiesto: true,
    referente_richiesto: true,
    soccorritore_richiesto: true,
    allievo_consentito: true
  },
  equipaggio_attuale: {
    autista: { ...slotVuoto },
    referente_soreu: { ...slotVuoto },
    soccorritore: { matricola: "123", nominativo: "Rossi Mario", convalidato_da_admin: false },
    allievo_quarto_posto: { ...slotVuoto }
  },
  log_modifiche: [
    {
      timestamp: new Date().toISOString(),
      autore: "script_test",
      azione: "Generazione Turno Test",
      notifica_inviata: false
    }
  ]
};

// 2. TURNO TRASPORTO SANITARIO (Tra due giorni)
const turnoTSFuture = {
  id_turno: "TURNO_TEST_TS_FUTURE",
  data: getDateOffset(2),
  orario: { inizio: "07:00", fine: "13:00" },
  tipo_servizio: "TRASPORTO_SANITARIO",
  stato_turno: "APERTO",
  requisiti_equipaggio: {
    autista_richiesto: true,
    referente_richiesto: false,
    soccorritore_richiesto: true,
    allievo_consentito: false
  },
  equipaggio_attuale: {
    autista: { ...slotVuoto },
    referente_soreu: { ...slotVuoto },
    soccorritore: { matricola: "287", nominativo: "Agostini Elisa", convalidato_da_admin: false },
    allievo_quarto_posto: { ...slotVuoto }
  },
  log_modifiche: [
    {
      timestamp: new Date().toISOString(),
      autore: "script_test",
      azione: "Generazione Turno Test",
      notifica_inviata: false
    }
  ]
};

// 3. TURNO DIPENDENTI / SERVIZIO FISSO (Tra tre giorni)
const turnoDipendenti = {
  id_turno: "TURNO_TEST_DIPENDENTI",
  data: getDateOffset(3),
  orario: { inizio: "14:00", fine: "20:00" },
  tipo_servizio: "TRASPORTO_SANITARIO",
  stato_turno: "APERTO",
  requisiti_equipaggio: {
    autista_richiesto: true,
    referente_richiesto: false,
    soccorritore_richiesto: true,
    allievo_consentito: false
  },
  equipaggio_attuale: {
    autista: { ...slotVuoto },
    referente_soreu: { ...slotVuoto },
    soccorritore: { ...slotVuoto },
    allievo_quarto_posto: { ...slotVuoto }
  },
  log_modifiche: [
    {
      timestamp: new Date().toISOString(),
      autore: "script_test",
      azione: "Generazione Turno Test",
      notifica_inviata: false
    }
  ]
};

const arrayTurniTest = [turno118Domani, turnoTSFuture, turnoDipendenti];

async function popolaTurniTest() {
  console.log("Inizio generazione dei documenti di test su Firestore...");
  let conteggioSuccessi = 0;

  for (const turno of arrayTurniTest) {
    try {
      const docRef = doc(db, "turni", turno.id_turno);
      await setDoc(docRef, turno);
      console.log(`[SUCCESSO] Documento '${turno.id_turno}' per la data ${turno.data} caricato correttamente.`);
      conteggioSuccessi++;
    } catch (errore) {
      console.error(`[ERRORE] Fallimento nel caricamento del documento '${turno.id_turno}':`, errore);
    }
  }

  console.log("====================================");
  console.log(`Popolamento concluso. Documenti inseriti: ${conteggioSuccessi} su ${arrayTurniTest.length}.`);
  console.log("====================================");
  
  process.exit(0);
}

popolaTurniTest();
