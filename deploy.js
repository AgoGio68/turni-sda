import fs from 'fs';
import { spawn, execSync } from 'child_process';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function isAffirmative(answer) {
    const cleanAnswer = answer.trim().toLowerCase();
    const affirmativeKeywords = ['s', 'si', 'sì', 'y', 'yes'];
    return affirmativeKeywords.includes(cleanAnswer);
}

async function runDeploy() {
    console.log("==================================================");
    console.log("🚀 INIZIO PROCEDURA DI DEPLOY - FIREBASE E GITHUB");
    console.log("==================================================");
    
    let versione = "Sconosciuta";
    try {
        const data = JSON.parse(fs.readFileSync('./versione_app.json', 'utf8'));
        versione = data.versione;
    } catch(e) {
        console.log("Errore nella lettura di versione_app.json");
    }

    console.log(`Versione rilevata nei file: ${versione}\n`);

    // FASE 1: Controllo Versione (Logica Corretta e Tollerante)
    const q1 = await askQuestion("Confermi che questa è la versione corretta che vuoi mandare in produzione e registrare su GitHub? (SÌ/NO): ");
    
    if (!isAffirmative(q1)) {
        console.log("\n❌ Modifica il file versione_app.json con la nuova versione prima di lanciare nuovamente il deploy.");
        rl.close();
        process.exit(1);
    }

    // FASE 2: Deploy Firebase Hosting
    console.log("");
    const q2 = await askQuestion("Procedere con il deploy ufficiale su Firebase Hosting per turni-sda? (SÌ/NO): ");
    
    if (!isAffirmative(q2)) {
        console.log("\nDeploy annullato.");
        rl.close();
        process.exit(0);
    }

    console.log("\nAvvio deploy Firebase in corso...");

    const deployProcess = spawn('npx', ['firebase', 'deploy', '--only', 'hosting'], { stdio: 'inherit', shell: true });
    
    deployProcess.on('close', async (code) => {
        if (code === 0) {
            console.log("\n✅ Deploy Firebase completato con successo!\n");
            
            // FASE 3: Automazione GitHub
            const q3 = await askQuestion(`Deploy Firebase completato. Vuoi aggiornare e sincronizzare il repository GitHub 'AgoGio68' usando la mail segnalaglielo@gmail.com? (SÌ/NO): `);
            
            if (isAffirmative(q3)) {
                console.log("\nInizio sincronizzazione con GitHub...\n");
                try {
                    // Configurazione temporanea della firma commit
                    execSync('git config user.email "segnalaglielo@gmail.com"', { stdio: 'inherit' });
                    execSync('git config user.name "AgoGio68"', { stdio: 'inherit' });
                    
                    // Tracking e Push
                    execSync('git add .', { stdio: 'inherit' });
                    execSync(`git commit -m "Deploy & Release ver. ${versione}"`, { stdio: 'inherit' });
                    
                    try {
                        execSync('git push origin main', { stdio: 'inherit' });
                    } catch (pushErr) {
                        console.log("⚠️ Fallito push su main, tento push su master...");
                        execSync('git push origin master', { stdio: 'inherit' });
                    }
                    
                    console.log("\n🎉 Sincronizzazione GitHub completata con successo!");
                } catch (err) {
                    console.log("\n❌ Errore durante i comandi Git. Verifica che la cartella sia un repository git valido e che tu abbia i permessi di push.");
                }
            } else {
                console.log("\nSincronizzazione GitHub saltata.");
            }
            
            rl.close();
            process.exit(0);
        } else {
            console.log(`\n❌ Errore durante il deploy Firebase (codice ${code}). Sincronizzazione Github abortita.`);
            rl.close();
            process.exit(1);
        }
    });
}

runDeploy();
