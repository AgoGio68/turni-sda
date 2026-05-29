import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, collection, query, onSnapshot, writeBatch, doc, getDoc, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAc_ZXW_6QXvG9yHRMxB3dbZEp9X8qTTzg",
  authDomain: "turni-sda.firebaseapp.com",
  projectId: "turni-sda",
  storageBucket: "turni-sda.firebasestorage.app",
  messagingSenderId: "840030023706",
  appId: "1:840030023706:web:1a6f738ed3051075c5a1a3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let modificheSospese = []; 
let turniOriginali = new Map();
let currentAdminUser = null;

const stagingBar = document.getElementById('staging-bar');
const stagingCount = document.getElementById('staging-count');
const tbody = document.querySelector('#admin-table tbody');
const superadminSection = document.getElementById('superadmin-section');
const superadminTbody = document.querySelector('#superadmin-table tbody');
const adminInfo = document.getElementById('admin-info');

document.addEventListener('DOMContentLoaded', () => {
  
  // 1. RBAC & Firebase Auth
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const matricola = user.email.split('@')[0];
      
      // Controllo Superadmin AgoGio
      if (matricola === 'agogio') {
          currentAdminUser = { matricola: 'agogio', nome: 'Ago', cognome: 'Gio', is_admin: true, superadmin: true };
          adminInfo.innerHTML = `Admin: SUPERADMIN <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
          document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
          
          superadminSection.style.display = 'block';
          initSuperadminPanel();
          initApp();
      } else {
          // Controllo Admin normale (Volontario con is_admin: true)
          const snap = await getDoc(doc(db, "utenti", matricola));
          if (snap.exists() && snap.data().is_admin) {
              currentAdminUser = snap.data();
              adminInfo.innerHTML = `Admin: ${currentAdminUser.nome} ${currentAdminUser.cognome} <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
              document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
              
              superadminSection.style.display = 'none'; // Nascosto
              initApp();
          } else {
              alert("Accesso negato: non hai i permessi di amministratore per questa vista.");
              signOut(auth);
          }
      }
    } else {
      window.location.href = "index.html"; // Redirect al login
    }
  });
  
  // 2. Pannello Superadmin (Solo AgoGio)
  function initSuperadminPanel() {
      const qU = query(collection(db, "utenti"));
      onSnapshot(qU, (snapshot) => {
          superadminTbody.innerHTML = '';
          const users = snapshot.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => (a.cognome||'').localeCompare(b.cognome||''));
          
          users.forEach(u => {
              const tr = document.createElement('tr');
              const isAdmin = !!u.is_admin;
              const badge = isAdmin ? `<span class="badge" style="background:rgba(57,255,20,0.1); border:1px solid var(--neon-green); color:var(--neon-green);">Admin</span>` : `<span class="badge" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-muted);">Utente</span>`;
              
              tr.innerHTML = `
                  <td>${u.matricola}</td>
                  <td>${u.nome} ${u.cognome}</td>
                  <td style="font-size:0.8rem; color:var(--text-muted);">${(u.ruoli_areu || []).join(', ')}</td>
                  <td>${badge}</td>
                  <td>
                      <button class="btn toggle-admin-btn" data-matricola="${u.matricola}" data-status="${isAdmin}" style="padding: 0.3rem 0.6rem; font-size:0.75rem; border-color:${isAdmin ? 'var(--neon-red)' : 'var(--neon-green)'}; color:${isAdmin ? 'var(--neon-red)' : 'var(--neon-green)'}">
                          ${isAdmin ? 'Revoca Admin' : 'Rendi Admin'}
                      </button>
                  </td>
              `;
              superadminTbody.appendChild(tr);
          });
          
          document.querySelectorAll('.toggle-admin-btn').forEach(btn => {
              btn.addEventListener('click', async (e) => {
                  const targetMatricola = e.currentTarget.getAttribute('data-matricola');
                  const currentStatus = e.currentTarget.getAttribute('data-status') === 'true';
                  try {
                      await updateDoc(doc(db, "utenti", targetMatricola), { is_admin: !currentStatus });
                  } catch(err) {
                      console.error("Errore modifica permessi admin", err);
                  }
              });
          });
      });
  }

  // 3. Tabellone Turni Responsabile
  function initApp() {
      const q = query(collection(db, "turni")); 
      
      onSnapshot(q, (snapshot) => {
        turniOriginali.clear();
        snapshot.docs.forEach(docSnap => {
          turniOriginali.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
        renderTable();
      });

      const renderTable = () => {
        tbody.innerHTML = '';
        const turniList = Array.from(turniOriginali.values()).sort((a,b) => (a.data||'').localeCompare(b.data||''));

        turniList.forEach(turno => {
          const tr = document.createElement('tr');
          const isStaged = modificheSospese.some(m => m.idTurno === turno.id);
          if (isStaged) {
            tr.classList.add('staged-row');
          }
          
          const eq = turno.equipaggio_attuale || {};
          const req = turno.requisiti_equipaggio || {};
          
          const formatCell = (membro, richiesto) => {
              if (membro?.matricola) {
                  return membro.convalidato_da_admin 
                      ? `<span style="color:var(--text-main)">${membro.nominativo}</span><br><span style="font-size:0.6rem; color:var(--neon-green);">✓ Conv.</span>`
                      : `<span style="color:var(--text-main)">${membro.nominativo}</span><br><span style="font-size:0.6rem; color:#38bdf8;">⚠ Attesa</span>`;
              }
              if (!richiesto) return `<em style="color:var(--text-muted); font-size: 0.85rem; opacity: 0.5;">N.D.</em>`;
              return `<em style="color:var(--neon-red); font-size: 0.85rem;">Vuoto</em>`;
          };

          let badgeClass = 'incompleto';
          let stato = turno.stato_turno || 'APERTO';
          
          const mancanteAutista = req.autista_richiesto && !eq.autista?.matricola;
          const mancanteReferente = req.referente_richiesto && !eq.referente_soreu?.matricola;
          const mancanteSoccorritore = req.soccorritore_richiesto && !eq.soccorritore?.matricola;
          
          if (mancanteAutista || mancanteReferente || mancanteSoccorritore) { 
            badgeClass = 'critico'; 
            stato = 'CRITICO'; 
          }
          else if (stato === 'CONVALIDATO') badgeClass = 'convalidato';
          else if (stato === 'COMPLETO' || (!mancanteAutista && !mancanteReferente && !mancanteSoccorritore)) { 
            badgeClass = 'pieno'; 
            stato = 'COMPLETO'; 
          }

          const dateParts = turno.data.split('-');
          const fDate = `${dateParts[2]}/${dateParts[1]}`;

          tr.innerHTML = `
            <td><strong style="color: var(--text-main); font-size: 1.1rem;">${fDate}</strong><br><span style="font-size:0.85rem; color:var(--text-muted)">${turno.orario?.inizio || ''}-${turno.orario?.fine || ''}</span></td>
            <td style="font-size:0.85rem;">${(turno.tipo_servizio || '').replace('_', ' ')}</td>
            <td><span class="badge ${badgeClass}" style="font-size: 0.65rem;">${stato}</span></td>
            <td>${formatCell(eq.autista, req.autista_richiesto)}</td>
            <td>${formatCell(eq.referente_soreu, req.referente_richiesto)}</td>
            <td>${formatCell(eq.soccorritore, req.soccorritore_richiesto)}</td>
            <td>${formatCell(eq.allievo_quarto_posto, req.allievo_consentito)}</td>
            <td style="display:flex; gap: 0.4rem; flex-wrap: wrap;">
              <button class="btn action-btn insert" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-green)">➕ Ins.</button>
              <button class="btn action-btn move" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-orange); color:var(--text-main)">🔄 Spos.</button>
              <button class="btn action-btn delete" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-red); color:var(--neon-red)">❌ Rim.</button>
              <button class="btn action-btn validate" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:#38bdf8; color:#38bdf8">✓ Conv.</button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        attachActionListeners();
      };

      const attachActionListeners = () => {
        document.querySelectorAll('.action-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const idTurno = e.currentTarget.getAttribute('data-id');
            let azione = '';
            
            if(e.currentTarget.classList.contains('insert')) azione = 'Inserimento forzato da Admin';
            if(e.currentTarget.classList.contains('move')) azione = "Spostamento d'ufficio da Admin";
            if(e.currentTarget.classList.contains('delete')) azione = 'Cancellazione operatore da Admin';
            if(e.currentTarget.classList.contains('validate')) azione = 'Convalida equipaggio da Admin';

            const turnoObj = turniOriginali.get(idTurno);
            const currentEq = turnoObj.equipaggio_attuale || {};
            
            let payloadModifica = null;
            let nuovoStatoTurno = turnoObj.stato_turno;

            if (azione.includes('Convalida')) {
                // Imposta convalidato_da_admin = true a tutti
                const validatedEq = { ...currentEq };
                ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                    if (validatedEq[r]?.matricola) validatedEq[r].convalidato_da_admin = true;
                });
                nuovoStatoTurno = 'CONVALIDATO';
                payloadModifica = { nuovoEquipaggio: validatedEq, nuovoStato: nuovoStatoTurno };
            } else {
                // Esempio Mock
                payloadModifica = {
                    nuovoEquipaggio: {
                        ...currentEq,
                        autista: azione.includes('Inserimento') ? { matricola: 'ADM01', nominativo: 'Volontario (Admin)', convalidato_da_admin: true } : 
                                 azione.includes('Cancellazione') ? { matricola: null, nominativo: null, convalidato_da_admin: false } : 
                                 currentEq.autista
                    },
                    nuovoStato: nuovoStatoTurno
                };
            }

            addChangeToStaging(idTurno, azione, payloadModifica);
          });
        });
      };

      const addChangeToStaging = (idTurno, azione, payloadModifica) => {
        modificheSospese = modificheSospese.filter(m => m.idTurno !== idTurno);
        
        modificheSospese.push({ 
            idTurno, 
            azione, 
            timestamp: new Date().toISOString(),
            payloadModifica,
            turnoVecchio: turniOriginali.get(idTurno)
        });
        
        updateStagingUI();
        renderTable(); 
      };

      const updateStagingUI = () => {
        if(modificheSospese.length > 0) {
          stagingBar.classList.add('active');
          const count = modificheSospese.length;
          stagingCount.textContent = `${count} modific${count > 1 ? 'he' : 'a'} pendente in bozza`;
        } else {
          stagingBar.classList.remove('active');
        }
      };

      document.getElementById('btn-discard').addEventListener('click', () => {
        if(confirm("Vuoi annullare tutte le modifiche pendenti in bozza?")) {
          modificheSospese = [];
          updateStagingUI();
          renderTable();
        }
      });

      const confermaEInviaNotifiche = async () => {
        if(modificheSospese.length === 0) return;
        
        try {
            const batch = writeBatch(db);
            const logNotifiche = [];

            for (const mod of modificheSospese) {
                const turnoRef = doc(db, "turni", mod.idTurno);
                
                const logEntry = {
                    timestamp: mod.timestamp,
                    autore: currentAdminUser.matricola, // Usa vero utente admin
                    azione: mod.azione,
                    notifica_inviata: true
                };

                const logsAttuali = mod.turnoVecchio.log_modifiche || [];
                
                batch.update(turnoRef, {
                    equipaggio_attuale: mod.payloadModifica.nuovoEquipaggio,
                    stato_turno: mod.payloadModifica.nuovoStato,
                    log_modifiche: [...logsAttuali, logEntry]
                });

                logNotifiche.push({
                    turno_id: mod.idTurno,
                    azione_admin: mod.azione,
                    data_turno: mod.turnoVecchio.data,
                    payload_push: `Turno del ${mod.turnoVecchio.data}: Variazione applicata da ${currentAdminUser.nome}.`
                });
            }

            await batch.commit();

            console.log("=========================================");
            console.log("🔔 PAYLOAD NOTIFICHE PUSH / EMAIL GENERATO");
            console.log("=========================================");
            console.log(JSON.stringify(logNotifiche, null, 2));

            alert(`Operazione Completata.\n${modificheSospese.length} modifiche salvate in database. Notifiche iniettate.`);
            
            modificheSospese = [];
            updateStagingUI();
        } catch (err) {
            console.error("Errore critico durante la WriteBatch:", err);
            alert("Si è verificato un problema di comunicazione con Firestore.");
        }
      };

      document.getElementById('btn-save').addEventListener('click', confermaEInviaNotifiche);
  }
});
