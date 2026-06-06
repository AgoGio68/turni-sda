const admin = require('firebase-admin');
const fs = require('fs');

async function copyCollection(sourceCollection, targetCollection) {
  const snapshot = await sourceCollection.get();
  
  if (snapshot.empty) {
    return;
  }

  for (const doc of snapshot.docs) {
    const data = doc.data();
    console.log(`Copiando documento: ${targetCollection.path}/${doc.id}`);
    await targetCollection.doc(doc.id).set(data);

    // Copia ricorsivamente le sottocollezioni
    const subcollections = await doc.ref.listCollections();
    for (const subcol of subcollections) {
      await copyCollection(subcol, targetCollection.doc(doc.id).collection(subcol.id));
    }
  }
}

async function migrate() {
  if (!fs.existsSync('./old-key.json') || !fs.existsSync('./new-key.json')) {
    console.error("ERRORE: I file 'old-key.json' e/o 'new-key.json' non sono stati trovati nella cartella principale!");
    console.error("Assicurati di scaricarli da Firebase e rinominarli correttamente.");
    process.exit(1);
  }

  const oldKey = require('./old-key.json');
  const newKey = require('./new-key.json');

  const oldApp = admin.initializeApp({
    credential: admin.credential.cert(oldKey)
  }, 'oldApp');

  const newApp = admin.initializeApp({
    credential: admin.credential.cert(newKey)
  }, 'newApp');

  const oldDb = oldApp.firestore();
  const newDb = newApp.firestore();

  console.log("Inizio la migrazione del database...");
  
  const collections = await oldDb.listCollections();
  
  for (const collection of collections) {
    console.log(`\n>>> Inizio copia della collezione: ${collection.id} <<<`);
    await copyCollection(collection, newDb.collection(collection.id));
  }
  
  console.log("\n✅ Migrazione completata con successo!");
}

migrate().catch(error => {
  console.error("Errore durante la migrazione:", error);
});
