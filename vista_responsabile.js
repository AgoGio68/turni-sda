/*
================================================================================================
CONFIGURAZIONI DA ATTIVARE MANUALMENTE SULLA CONSOLE FIREBASE (BLOCCANTI PER IL LOGIN)
================================================================================================
1. Authentication: Abilitare il provider "Email/Password".
2. Firestore Database: Creare una collezione "utenti" e "turni".
3. Firestore Rules:
   - match /utenti/{matricola} { allow read, write: if request.auth != null; }
   - match /turni/{turno} { allow read, write: if request.auth != null; }
4. L'utente superadmin 'agogio@turni-sda.local' deve esistere in Firebase Auth.
================================================================================================
*/
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, collection, getDocs, updateDoc, doc, onSnapshot, query, writeBatch, getDoc, runTransaction, setDoc, deleteDoc } from "firebase/firestore";
import { formattaNominativoUtente, ordinaUtentiAlfabetico, formattaNomeDisplay } from './utils.js';

const firebaseConfig = {
  apiKey: "AIzaSyAc_ZXW_6QXvG9yHRMxB3dbZEp9X8qTTzg",
  authDomain: "turni-sda.firebaseapp.com",
  projectId: "turni-sda",
  storageBucket: "turni-sda.firebasestorage.app",
  messagingSenderId: "840030023706",
  appId: "1:840030023706:web:1a6f738ed3051075c5a1a3"
};

let app, auth, db;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  console.error("Errore inizializzazione Firebase:", err.code, err.message);
}

let modificheSospese = []; 
let turniOriginali = new Map();
let currentAdminUser = null;
let recentlyUpdatedRoles = new Set();
let pendingMoveData = null;

const stagingBar = document.getElementById('staging-bar');
const stagingCount = document.getElementById('staging-count');
const tbody = document.querySelector('#admin-table tbody');
const superadminSection = document.getElementById('superadmin-section');
const superadminTbody = document.querySelector('#superadmin-table tbody');
const adminInfo = document.getElementById('admin-info');

document.addEventListener('DOMContentLoaded', () => {
  
  // 1. RBAC & Firebase Auth
  const isSuperAdminOverride = localStorage.getItem('superadmin_override') === 'true';
  
  if (isSuperAdminOverride) {
      currentAdminUser = { matricola: 'agogio', nome: 'Ago', cognome: 'Gio', is_admin: true, superadmin: true };
      adminInfo.innerHTML = `Admin: SUPERADMIN <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
      document.getElementById('logout-btn').addEventListener('click', () => {
          localStorage.removeItem('superadmin_override');
          signOut(auth).catch(() => {});
          window.location.href = "index.html";
      });
      
      superadminSection.style.display = 'block';
      initSuperadminPanel();
      initApp();
      return;
  }

  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        const matricola = user.email.split('@')[0];
        
        // Controllo Superadmin AgoGio fallback (se auth persistito ma no localStorage)
        if (matricola.toLowerCase() === 'agogio') {
            localStorage.setItem('superadmin_override', 'true');
            currentAdminUser = { matricola: 'agogio', nome: 'Ago', cognome: 'Gio', is_admin: true, superadmin: true };
            adminInfo.innerHTML = `Admin: SUPERADMIN <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
            document.getElementById('logout-btn').addEventListener('click', () => {
                localStorage.removeItem('superadmin_override');
                signOut(auth);
                window.location.href = "index.html";
            });
            
            superadminSection.style.display = 'block';
            initSuperadminPanel();
            initApp();
        } else {
            // Controllo Admin normale (Volontario con is_admin: true)
            const snap = await getDoc(doc(db, "utenti", matricola));
            if (snap.exists() && snap.data().is_admin) {
                currentAdminUser = snap.data();
                
                const isSuper = (currentAdminUser.ruolo === 'superadmin' || currentAdminUser.superadmin === true);
                if (isSuper) {
                    currentAdminUser.superadmin = true;
                    superadminSection.style.display = 'block';
                    initSuperadminPanel();
                } else {
                    superadminSection.style.display = 'none';
                }
                
                adminInfo.innerHTML = `Admin: ${formattaNomeDisplay(currentAdminUser.nominativo || formattaNominativoUtente(currentAdminUser))} <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
                document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
                
                initApp();
                initPresence();
            } else {
                console.error("Accesso negato: Permessi non sufficienti per la matricola", matricola);
                alert("Accesso negato: non hai i permessi di amministratore per questa vista.");
                signOut(auth);
            }
        }
      } else {
        window.location.href = "index.html"; // Redirect al login
      }
    } catch (e) {
      console.error("Errore in onAuthStateChanged Responsabile:", e.code, e.message);
    }
  });
  
  // 1.5. Presenza Live Admin
  function initPresence() {
      const presenceRef = doc(db, 'utenti', currentAdminUser.matricola);
      
      const updatePresence = () => {
          setDoc(presenceRef, {
              last_active: Date.now()
          }, { merge: true }).catch(e => console.error("Presence update failed:", e));
      };
      
      updatePresence();
      setInterval(updatePresence, 30000); // 30 seconds heartbeat
      
      const presenceQuery = query(collection(db, 'utenti'));
      onSnapshot(presenceQuery, (snap) => {
          const now = Date.now();
          const activeAdmins = [];
          snap.forEach(d => {
              const data = d.data();
              // Check if they are an admin and active
              if (d.id !== currentAdminUser.matricola && data.last_active > now - 60000 && (data.ruolo === 'admin' || data.ruolo === 'superadmin' || data.is_admin || data.superadmin)) {
                  activeAdmins.push(data.nominativo || formattaNominativoUtente(data));
              }
          });
          
          const container = document.getElementById('active-admins');
          if (container) {
              if (activeAdmins.length > 0) {
                  container.innerHTML = `🟢 Altri admin online: ${activeAdmins.map(n => formattaNomeDisplay(n)).join(', ')}`;
              } else {
                  container.innerHTML = `Nessun altro admin online in questo momento.`;
              }
          }
      });
  }
  
  // 2. Pannello Superadmin (Solo AgoGio)
  
  function initSuperadminPanel() {
      const qU = query(collection(db, "utenti"));
      onSnapshot(qU, (snapshot) => {
          superadminTbody.innerHTML = '';
          let users = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
          users = ordinaUtentiAlfabetico(users);
          
          users.forEach(u => {
              try {
                  const tr = document.createElement('tr');
                  const isAdmin = !!u.is_admin;
                  const badge = isAdmin ? `<span class="badge" style="background:rgba(57,255,20,0.1); border:1px solid var(--neon-green); color:var(--neon-green);">Admin</span>` : `<span class="badge" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-muted);">Utente</span>`;
                  
                  const isSuperAdmin = currentAdminUser && currentAdminUser.superadmin;
                  const currentRuolo = u.ruolo || ''; 
                  const roleOptions = [
                      { val: '', text: '--- Seleziona Ruolo ---' },
                      { val: 'superadmin', text: 'Superadmin / Presidente' },
                      { val: 'admin', text: 'Amministratore / Segreteria' },
                      { val: 'autista', text: 'Autista (AUT)' },
                      { val: 'caposquadra', text: 'Caposquadra / Riferimento (RIF)' },
                      { val: 'soccorritore', text: 'Soccorritore (SOC)' },
                      { val: 'allievo', text: 'Allievo / Milite in Prova' },
                      { val: 'kiosk', text: 'Schermo / Monitor Sede' }
                  ];
                  const optionsHtml = roleOptions.map(opt => `<option value="${opt.val}" ${currentRuolo === opt.val ? 'selected' : ''}>${opt.text}</option>`).join('');
                  
                  const isRecentlyUpdated = recentlyUpdatedRoles.has(u.matricola);
                  const extraStyles = isRecentlyUpdated ? 'border-color: var(--neon-green); box-shadow: 0 0 8px var(--neon-green);' : 'border-color: rgba(255,255,255,0.2);';
                  
                  const selectHtml = `<select class="role-select" data-matricola="${u.matricola}" ${!isSuperAdmin ? 'disabled' : ''} style="background: rgba(0,0,0,0.3); color: var(--text-main); padding: 0.3rem; border-radius: 4px; font-size: 0.8rem; margin-left: 0.5rem; outline: none; transition: all 0.3s ease; border: 1px solid transparent; ${extraStyles}">
                      ${optionsHtml}
                  </select>`;
                  
                  const ruoliStampati = Array.isArray(u.ruoli_areu) ? u.ruoli_areu.join(', ') : (u.ruoli_areu || '');
                  
                  tr.innerHTML = `
                      <td>${u.matricola}</td>
                      <td>
                          <div style="display:flex; align-items:center;">
                              <span>${formattaNomeDisplay(u.nominativo || formattaNominativoUtente(u))}</span>
                              ${selectHtml}
                          </div>
                      </td>
                      <td style="font-size:0.8rem; color:var(--text-muted);">${ruoliStampati}</td>
                      <td>${badge}</td>
                      <td>
                          <button class="btn toggle-admin-btn" data-matricola="${u.matricola}" data-status="${isAdmin}" style="padding: 0.3rem 0.6rem; font-size:0.75rem; border-color:${isAdmin ? 'var(--neon-red)' : 'var(--neon-green)'}; color:${isAdmin ? 'var(--neon-red)' : 'var(--neon-green)'}">
                              ${isAdmin ? 'Revoca Admin' : 'Rendi Admin'}
                          </button>
                      </td>
                  `;
                  superadminTbody.appendChild(tr);
              } catch(e) {
                  console.error("Errore nel rendering dell'utente", u, e);
              }
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
          
          document.querySelectorAll('.role-select').forEach(select => {
              select.addEventListener('change', async (e) => {
                  const targetMatricola = e.currentTarget.getAttribute('data-matricola');
                  const newRole = e.currentTarget.value;
                  
                  e.currentTarget.style.opacity = '0.5';
                  e.currentTarget.style.pointerEvents = 'none';
                  
                  try {
                      recentlyUpdatedRoles.add(targetMatricola);
                      await updateDoc(doc(db, "utenti", targetMatricola), { ruolo: newRole });
                      
                      setTimeout(() => {
                          recentlyUpdatedRoles.delete(targetMatricola);
                          const updatedSelect = document.querySelector(`.role-select[data-matricola="${targetMatricola}"]`);
                          if(updatedSelect) {
                              updatedSelect.style.borderColor = 'rgba(255,255,255,0.2)';
                              updatedSelect.style.boxShadow = 'none';
                          }
                      }, 2000);
                      
                  } catch(err) {
                      console.error("Errore modifica ruolo", err);
                      alert("Errore durante il salvataggio del ruolo.");
                      recentlyUpdatedRoles.delete(targetMatricola);
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.pointerEvents = 'auto';
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
        const turniList = Array.from(turniOriginali.values()).sort((a,b) => {
            const cmp = (a.data||'').localeCompare(b.data||'');
            if (cmp !== 0) return cmp;
            return (a.orario?.inizio||'').localeCompare(b.orario?.inizio||'');
        });

        if (turniList.length === 0) return;

        const EPOCH = new Date('2024-05-31T20:00:00').getTime();
        const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
        
        const getCycleIndex = (turno) => {
            const tDate = new Date(`${turno.data}T${turno.orario?.inizio || "00:00"}:00`).getTime();
            return Math.floor((tDate - EPOCH) / WEEK_MS);
        };

        const firstCycleIndex = getCycleIndex(turniList[0]);
        const teams = ['A', 'B', 'C'];

        turniList.forEach((turno, index) => {
          const tr = document.createElement('tr');
          const isStaged = modificheSospese.some(m => m.idTurno === turno.id);
          if (isStaged) {
            tr.classList.add('staged-row');
          }
          
          const eq = turno.equipaggio_attuale || {};
          const req = turno.requisiti_equipaggio || {};
          
          const formatCell = (membro, richiesto, roleKey) => {
              if (membro?.matricola) {
                  const nomeDisplay = formattaNomeDisplay(membro.nominativo);
                  const nameColor = membro.convalidato_da_admin ? '#32CD32' : '#FFD700';
                  
                  const isAdmin = currentAdminUser?.ruolo === 'admin' || currentAdminUser?.ruolo === 'superadmin' || currentAdminUser?.is_admin === true || currentAdminUser?.superadmin === true;
                  const btnRemoveHtml = isAdmin ? `<button class="admin-remove-vol" data-turno="${turno.id}" data-ruolo="${roleKey}" title="Rimuovi Volontario" style="background:transparent; border:none; cursor:pointer; margin-left:0.3rem; color:var(--neon-red); font-size:1rem; padding:0;">❌</button>` : '';

                  return membro.convalidato_da_admin 
                      ? `<span style="color:${nameColor}; font-weight:bold;">${nomeDisplay}</span>${btnRemoveHtml}<br><span style="font-size:0.6rem; color:var(--neon-green);">✓ Conv.</span>`
                      : `<span style="color:${nameColor}; font-weight:bold;">${nomeDisplay}</span>${btnRemoveHtml}<br><span style="font-size:0.6rem; color:#38bdf8;">⚠ Attesa</span>`;
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

          const currentCycleIndex = getCycleIndex(turno);
          const diffWeeks = currentCycleIndex - firstCycleIndex;
          let startIdx = teams.indexOf(window.startingTeam || 'A');
          if (startIdx === -1) startIdx = 0;
          
          const currentTeamIdx = (((startIdx + diffWeeks) % 3) + 3) % 3;
          const teamLet = teams[currentTeamIdx];
          
          let squadraHtml = '';
          if (index === 0) {
              squadraHtml = `
                <select id="start-team-selector" style="background:rgba(0,0,0,0.3); color:var(--text-main); border:1px solid var(--border-glass); padding:0.2rem; border-radius:4px; font-weight:bold; font-size:1.1rem; width: 60px;">
                  <option value="A" ${window.startingTeam === 'A' ? 'selected' : ''}>A</option>
                  <option value="B" ${window.startingTeam === 'B' ? 'selected' : ''}>B</option>
                  <option value="C" ${window.startingTeam === 'C' ? 'selected' : ''}>C</option>
                </select>
              `;
          } else {
              squadraHtml = `<strong style="font-size: 1.2rem; color: var(--primary-neon); margin-left: 0.5rem;">${teamLet}</strong>`;
          }

          tr.innerHTML = `
            <td>${squadraHtml}</td>
            <td><strong style="color: var(--text-main); font-size: 1.1rem;">${fDate}</strong><br><span style="font-size:0.85rem; color:var(--text-muted)">${turno.orario?.inizio || ''}-${turno.orario?.fine || ''}</span></td>
            <td><span class="badge ${badgeClass}" style="font-size: 0.65rem;">${stato}</span></td>
            <td>${formatCell(eq.autista, req.autista_richiesto, 'autista')}</td>
            <td>${formatCell(eq.referente_soreu, req.referente_richiesto, 'referente_soreu')}</td>
            <td>${formatCell(eq.soccorritore, req.soccorritore_richiesto, 'soccorritore')}</td>
            <td>${formatCell(eq.allievo_quarto_posto, req.allievo_consentito, 'allievo_quarto_posto')}</td>
            <td style="display:flex; gap: 0.4rem; flex-wrap: wrap;">
              <button class="btn action-btn insert" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-green)">➕ Ins.</button>
              <button class="btn action-btn move" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-orange); color:var(--text-main)">🔄 Spos.</button>
              <button class="btn action-btn delete" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-red); color:var(--neon-red)">❌ Rim.</button>
              <button class="btn action-btn validate" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:#38bdf8; color:#38bdf8">✓ Conv.</button>
            </td>
          `;
          tbody.appendChild(tr);
        });

        const startTeamSelector = document.getElementById('start-team-selector');
        if (startTeamSelector) {
            startTeamSelector.addEventListener('change', (e) => {
                window.startingTeam = e.target.value;
                renderTable();
            });
        }

        document.querySelectorAll('.admin-remove-vol').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idTurno = e.currentTarget.getAttribute('data-turno');
                const ruolo = e.currentTarget.getAttribute('data-ruolo');
                await rimuoviVolontarioImprevisto(idTurno, ruolo);
            });
        });

        attachActionListeners();
      };

      const rimuoviVolontarioImprevisto = async (idTurno, ruolo) => {
        if(!confirm("Sei sicuro di voler rimuovere il volontario dal turno?")) return;
        const turnoTarget = turniOriginali.get(idTurno);
        if (!turnoTarget) return;

        try {
            const docRef = doc(db, "turni", idTurno);
            const eq = { ...turnoTarget.equipaggio_attuale };
            
            if (ruolo === 'autista') eq.autista = { matricola: null, nominativo: null, convalidato_da_admin: false };
            if (ruolo === 'referente_soreu') eq.referente_soreu = { matricola: null, nominativo: null, convalidato_da_admin: false };
            if (ruolo === 'soccorritore') eq.soccorritore = { matricola: null, nominativo: null, convalidato_da_admin: false };
            if (ruolo === 'allievo_quarto_posto') eq.allievo_quarto_posto = { matricola: null, nominativo: null, convalidato_da_admin: false };

            const logs = turnoTarget.log_modifiche || [];
            logs.push({
                timestamp: new Date().toISOString(),
                autore: currentAdminUser.matricola,
                azione: `Rimozione imprevista admin per slot ${ruolo.replace(/_/g, ' ')}`,
                notifica_inviata: false
            });

            await updateDoc(docRef, {
                equipaggio_attuale: eq,
                log_modifiche: logs
            });
            
        } catch (err) {
            console.error("Errore rimozione:", err);
            alert("Si è verificato un errore di rete durante la rimozione.");
        }
      };

      const attachActionListeners = () => {
        console.log('Tasto spostamento inizializzato');
        console.log('Tasto spostamento inizializzato: inizio hook degli action-btn');
        document.querySelectorAll('.action-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const idTurno = e.currentTarget.getAttribute('data-id');
            const turnoObj = turniOriginali.get(idTurno);
            
            if(e.currentTarget.classList.contains('insert')) {
                if(typeof openInsertModal === 'function') openInsertModal(turnoObj);
                return;
            }
            if(e.currentTarget.classList.contains('move')) {
                console.log('Tasto spostamento cliccato sul turno ID:', idTurno);
                if (!pendingMoveData) {
                    if (typeof window.openMoveSourceModal === 'function') {
                        window.openMoveSourceModal(turnoObj);
                    } else {
                        console.error('ERRORE: window.openMoveSourceModal non è una funzione!');
                        alert('Errore di caricamento: funzione di spostamento non trovata.');
                    }
                } else {
                    if (typeof window.openMoveDestModal === 'function') {
                        window.openMoveDestModal(turnoObj);
                    } else {
                        console.error('ERRORE: window.openMoveDestModal non è una funzione!');
                    }
                }
                return;
            }

            let azione = '';
            if(e.currentTarget.classList.contains('delete')) azione = 'Cancellazione operatore da Admin';
            if(e.currentTarget.classList.contains('validate')) azione = 'Convalida equipaggio da Admin';

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

  // --- LOGICA MODALE INSERIMENTO ---
  let modalTurnoId = null;
  let allVolunteersCache = null;

  const modalOverlay = document.getElementById('modal-inserimento');
  const modalTitle = document.getElementById('modal-title');
  const modalRoleSelect = document.getElementById('modal-role-select');
  const modalSearch = document.getElementById('modal-search');
  const modalVolunteersList = document.getElementById('modal-volunteers-list');
  const modalLoading = document.getElementById('modal-loading');

  window.openInsertModal = function(turnoObj) {
    if(!modalOverlay) return;
    modalTurnoId = turnoObj.id;
    const targetDate = `${turnoObj.data} ${turnoObj.orario?.inizio||''}`;
    
    modalRoleSelect.innerHTML = '';
    const req = turnoObj.requisiti_equipaggio || {};
    const eq = turnoObj.equipaggio_attuale || {};
    
    const options = [];
    if (req.autista_richiesto) options.push({val: 'AUT', label: 'Autista', field: 'autista', occ: eq.autista?.matricola});
    if (req.referente_richiesto) options.push({val: 'RIF', label: 'Referente SOREU', field: 'referente_soreu', occ: eq.referente_soreu?.matricola});
    if (req.soccorritore_richiesto) options.push({val: 'SOC', label: 'Soccorritore', field: 'soccorritore', occ: eq.soccorritore?.matricola});
    if (req.allievo_consentito) options.push({val: 'ALL', label: 'Allievo', field: 'allievo_quarto_posto', occ: eq.allievo_quarto_posto?.matricola});
    
    if(options.length === 0) {
      alert("Questo turno non ha requisiti configurati.");
      return;
    }

    options.forEach(opt => {
      const status = opt.occ ? '(Occupato)' : '(Libero)';
      modalRoleSelect.innerHTML += `<option value="${opt.val}" data-field="${opt.field}">${opt.label} ${status}</option>`;
    });
    
    const updateModalTitle = () => {
      if(!modalRoleSelect.options.length) return;
      const roleLabel = modalRoleSelect.options[modalRoleSelect.selectedIndex].text.split(' (')[0];
      modalTitle.textContent = `Inserisci ${roleLabel} per il turno ${targetDate}`;
    };
    
    modalRoleSelect.onchange = () => {
      updateModalTitle();
      loadAndFilterVolunteers();
    };
    
    updateModalTitle();
    modalSearch.value = '';
    modalOverlay.classList.add('active');
    modalOverlay.style.display = 'flex';
    
    loadAndFilterVolunteers();
  };

  if(document.getElementById('modal-close')) {
    document.getElementById('modal-close').onclick = () => {
      modalOverlay.classList.remove('active');
      setTimeout(() => modalOverlay.style.display = 'none', 300);
    };
  }

  if(modalSearch) {
    modalSearch.addEventListener('input', () => {
      renderVolunteersList();
    });
  }

  async function loadAndFilterVolunteers() {
    modalVolunteersList.innerHTML = '';
    modalLoading.style.display = 'block';
    
    try {
      if (!allVolunteersCache) {
        const snap = await getDocs(collection(db, "utenti"));
        allVolunteersCache = snap.docs.map(d => d.data());
      }
      console.log("--- DEBUG STRUTTURA VOLONTARIO ---");
      if (allVolunteersCache.length > 0) {
          const v = allVolunteersCache[0];
          console.log("Chiavi disponibili nell'oggetto:", Object.keys(v));
          console.log("Valore del primo record:", JSON.stringify(v, null, 2));
      }
      
      if(!allVolunteersCache || allVolunteersCache.length === 0) {
        console.warn("ATTENZIONE: Array volontari vuoto. Impossibile procedere.");
        modalVolunteersList.innerHTML = '<p style="color:var(--neon-red); text-align:center;">Nessun dato volontari scaricato dal database.</p>';
        modalLoading.style.display = 'none';
        return;
      }
    } catch(err) {
      console.error("Errore caricamento volontari", err);
    }
    
    modalLoading.style.display = 'none';
    renderVolunteersList();
  }

  function renderVolunteersList() {
    if(!allVolunteersCache) return;
    
    const search = modalSearch.value.toLowerCase().trim();
    
    const selectedOption = modalRoleSelect.options[modalRoleSelect.selectedIndex];
    const targetField = selectedOption ? selectedOption.getAttribute('data-field') : null;

    const possiedeRuolo = (v, ruoloCercato) => {
        if (!v.ruoli_areu || !Array.isArray(v.ruoli_areu)) return false;
        return v.ruoli_areu.some(r => r.toLowerCase() === ruoloCercato.toLowerCase());
    };
    
    // Filtro testuale e per ruolo
    let filtered = allVolunteersCache.filter(v => {
      // 1. Escludi inattivi
      if (v.attivo === false) return false;

      // 2. Filtro Testuale
      const nomeCompleto = `${v.nome || ''} ${v.cognome || ''}`.toLowerCase();
      if (search && !nomeCompleto.includes(search)) return false;

      // 3. Filtro per Ruolo
      if (targetField === 'autista') {
          if (!possiedeRuolo(v, 'Autista MSB')) return false;
      } else if (targetField === 'referente_soreu') {
          if (!possiedeRuolo(v, 'Socc. Referente per SOREU')) return false;
      } else if (targetField === 'soccorritore') {
          if (!possiedeRuolo(v, 'Soccorritore')) return false;
      } else if (targetField === 'allievo_quarto_posto') {
          if (!(possiedeRuolo(v, 'allievo/a') || possiedeRuolo(v, 'allievo') || possiedeRuolo(v, 'allieva'))) return false;
      }

      return true;
    });

    // Ordinamento alfabetico crescente (A-Z) per Cognome Nome
    filtered.sort((a, b) => {
      const nameA = `${a.cognome || ''} ${a.nome || ''}`.trim().toLowerCase();
      const nameB = `${b.cognome || ''} ${b.nome || ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    modalVolunteersList.innerHTML = '';
    
    filtered.forEach(u => {
      const div = document.createElement('div');
      div.className = 'volunteer-item';
      div.innerHTML = `
        <div>
          <strong>${u.nome || ''} ${u.cognome || ''}</strong><br>
          <small>Matricola: ${u.matricola || 'N/A'}</small>
        </div>
        <button class="btn">Seleziona</button>
      `;
      div.onclick = () => selectVolunteerForSlot(u);
      modalVolunteersList.appendChild(div);
    });
  }

  async function selectVolunteerForSlot(user) {
    const selectedOption = modalRoleSelect.options[modalRoleSelect.selectedIndex];
    const field = selectedOption.getAttribute('data-field');
    const isOccupied = selectedOption.text.includes('(Occupato)');
    
    if (isOccupied) {
      if (!confirm("Questo slot è già occupato. Sovrascrivere il volontario attuale?")) return;
    }
    
    try {
      modalLoading.style.display = 'block';
      
      await runTransaction(db, async (transaction) => {
          const turnoRef = doc(db, "turni", modalTurnoId);
          const turnoSnap = await transaction.get(turnoRef);
          
          if (!turnoSnap.exists()) {
              throw "Il turno non esiste più.";
          }
          
          const turnoData = turnoSnap.data();
          const currentEq = turnoData.equipaggio_attuale || {};
          
          // Se stavamo inserendo in uno slot originariamente libero, ma ora è occupato, blocchiamo
          if (!isOccupied && currentEq[field]?.matricola) {
              throw "SLOT_OCCUPATO";
          }
          
          const newEq = { ...currentEq };
          newEq[field] = {
              matricola: user.matricola,
              nominativo: user.nominativo || formattaNominativoUtente(user),
              convalidato_da_admin: true
          };
          
          transaction.update(turnoRef, { equipaggio_attuale: newEq });
      });
      
      modalLoading.style.display = 'none';
      if(document.getElementById('modal-close')) document.getElementById('modal-close').click();
    } catch(e) {
      modalLoading.style.display = 'none';
      if (e === "SLOT_OCCUPATO") {
          alert("Slot appena occupato da un altro utente. L'operazione è stata annullata per evitare sovrascritture accidentali.");
      } else {
          console.error(e);
          alert("Errore durante l'aggiornamento del turno.");
      }
    }
  }
  // --- LOGICA SPOSTAMENTO IN DUE STEP (COMPLETAMENTE DINAMICA) ---

  function closeMoveSourceModal() {
      const modal = document.getElementById('dynamic-modal-move-source');
      if (modal) modal.remove();
  }

  function closeMoveDestModal() {
      const modal = document.getElementById('dynamic-modal-move-dest');
      if (modal) modal.remove();
  }

  function cancelMove() {
      pendingMoveData = null;
      const banner = document.getElementById('dynamic-move-banner');
      if (banner) banner.remove();
  }

  function createDynamicMoveBanner(name, dateStr) {
      cancelMove(); // Assicura che non ci siano banner precedenti
      
      const banner = document.createElement('div');
      banner.id = 'dynamic-move-banner';
      banner.style.position = 'fixed';
      banner.style.bottom = '20px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.background = 'rgba(255, 165, 0, 0.9)';
      banner.style.border = '2px solid var(--neon-orange, #ff9900)';
      banner.style.padding = '1rem 2rem';
      banner.style.borderRadius = '8px';
      banner.style.zIndex = '1000';
      banner.style.boxShadow = '0 0 15px rgba(255, 165, 0, 0.5)';
      banner.style.backdropFilter = 'blur(10px)';
      banner.style.color = '#fff';
      banner.style.fontWeight = 'bold';
      banner.style.textAlign = 'center';
      banner.style.maxWidth = '90vw';
      
      banner.innerHTML = `
        <span style="font-size: 1.2rem;">🔄 Stai spostando <span style="color: #fff; text-decoration: underline;">${name}</span> dal turno del <span style="color: #fff;">${dateStr}</span>.</span><br>
        <span style="font-size: 0.95rem; opacity: 0.9;">Clicca sul tasto 'Spos.' del turno di destinazione per incollarlo, oppure</span>
        <button id="dynamic-btn-cancel-move" class="btn" style="background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 0.3rem 0.8rem; margin-left: 10px; font-size: 0.8rem;">Annulla Spostamento</button>
      `;
      
      document.body.appendChild(banner);
      document.getElementById('dynamic-btn-cancel-move').addEventListener('click', cancelMove);
  }

  function getVolName(vol) {
      if (!vol) return null;
      if (typeof vol === 'string') return vol;
      return vol.nominativo || vol.nome || vol.cognome || vol.displayName || vol.matricola || null;
  }

  function forceRenderModal(volontari) {
      const overlay = document.createElement('div');
      overlay.id = 'modal-debug-force';
      overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:99999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white;';
      
      overlay.innerHTML = '<h1>Seleziona Volontario da spostare</h1>';
      
      volontari.forEach(v => {
          const btn = document.createElement('button');
          btn.innerText = v.nominativo;
          btn.style.cssText = 'margin:10px; padding:20px; font-size:20px; cursor:pointer; color:black;';
          btn.onclick = () => { alert('Selezionato: ' + v.nominativo); overlay.remove(); };
          overlay.appendChild(btn);
      });

      const closeBtn = document.createElement('button');
      closeBtn.innerText = 'CHIUDI';
      closeBtn.style.cssText = 'margin-top:40px; padding:15px; font-size:18px; cursor:pointer; background:red; color:white; border:none;';
      closeBtn.onclick = () => overlay.remove();
      overlay.appendChild(closeBtn);
      
      document.body.appendChild(overlay);
  }

  window.openMoveSourceModal = function(turnoObj) {
      console.log('Tentativo di apertura modale (Sorgente dinamica)...');
      
      const volontari = [];
      if (turnoObj && turnoObj.equipaggio_attuale) {
          for (const vol of Object.values(turnoObj.equipaggio_attuale)) {
              if (vol && vol.nominativo) {
                  volontari.push(vol);
              }
          }
      }
      forceRenderModal(volontari);
  };

  window.openMoveDestModal = function(turnoObj) {
      if (!pendingMoveData) return;
      
      closeMoveDestModal();
      
      const eq = turnoObj.equipaggio_attuale || {};
      const req = turnoObj.requisiti_equipaggio || {};

      const overlay = document.createElement('div');
      overlay.id = 'dynamic-modal-move-dest';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(0,0,0,0.8)';
      overlay.style.zIndex = '9999';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';

      const content = document.createElement('div');
      content.className = 'glass-panel modal-content';
      content.style.maxWidth = '400px';
      content.style.width = '100%';
      content.style.position = 'relative';

      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.style.position = 'absolute';
      closeBtn.style.top = '1rem';
      closeBtn.style.right = '1rem';
      closeBtn.style.background = 'transparent';
      closeBtn.style.border = 'none';
      closeBtn.style.color = 'var(--text-muted, #94a3b8)';
      closeBtn.style.fontSize = '1.5rem';
      closeBtn.style.cursor = 'pointer';
      closeBtn.onclick = closeMoveDestModal;

      const title = document.createElement('h3');
      title.textContent = 'In quale ruolo vuoi incollarlo?';
      title.style.marginTop = '0';
      title.style.color = 'var(--neon-orange, #ff9900)';

      const desc = document.createElement('p');
      desc.innerHTML = `Scegli lo slot di destinazione per <strong style="color:var(--text-main, #f1f5f9);">${pendingMoveData.volunteer.nominativo}</strong>:`;
      desc.style.color = 'var(--text-muted, #94a3b8)';
      desc.style.fontSize = '0.9rem';

      const listDiv = document.createElement('div');
      listDiv.style.maxHeight = '300px';
      listDiv.style.overflowY = 'auto';
      listDiv.style.display = 'flex';
      listDiv.style.flexDirection = 'column';
      listDiv.style.gap = '0.5rem';

      const addDestOption = (roleKey, label, isRequired) => {
          if (isRequired === false) return;
          const volOccupant = eq[roleKey];
          const occupantName = volOccupant && volOccupant.nominativo ? volOccupant.nominativo : '';
          const isOccupied = !!occupantName;
          
          const item = document.createElement('div');
          item.className = 'volunteer-item';
          item.style.padding = '0.8rem';
          item.style.background = 'rgba(255,255,255,0.05)';
          item.style.border = '1px solid var(--border-glass, rgba(255,255,255,0.1))';
          item.style.borderRadius = '8px';
          item.style.cursor = 'pointer';
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          item.style.alignItems = 'center';

          item.innerHTML = `
            <div>
              <strong style="color:var(--primary-neon, #3b82f6);">${label}</strong><br>
              <small style="${isOccupied ? 'color:var(--neon-red, #ff073a);' : 'color:var(--neon-green, #39ff14);'}">${isOccupied ? 'Occupato (' + occupantName + ')' : 'Libero'}</small>
            </div>
            <button class="btn" style="border-color:var(--neon-green, #39ff14); color:var(--text-main, #f1f5f9);">Incolla qui</button>
          `;
          item.onclick = () => confirmMoveTransaction(turnoObj.id, roleKey, isOccupied);
          listDiv.appendChild(item);
      };

      addDestOption('autista', 'Autista MSB', req.autista_richiesto);
      addDestOption('referente_soreu', 'Socc. Referente per SOREU', req.referente_richiesto);
      addDestOption('soccorritore', 'Soccorritore', req.soccorritore_richiesto);
      addDestOption('allievo_quarto_posto', 'Allievo (4° Posto)', req.allievo_consentito !== false);
      
      if (listDiv.children.length === 0) {
          listDiv.innerHTML = '<p style="color:var(--text-muted);">Nessun ruolo disponibile per la destinazione.</p>';
      }

      content.appendChild(closeBtn);
      content.appendChild(title);
      content.appendChild(desc);
      content.appendChild(listDiv);
      overlay.appendChild(content);
      
      document.body.appendChild(overlay);
  };

  async function confirmMoveTransaction(destTurnoId, destRoleKey, destWasOccupied) {
      if (!pendingMoveData) return;
      
      if (destWasOccupied) {
          if (!confirm("ATTENZIONE: Lo slot di destinazione è occupato. Questa operazione sovrascriverà il volontario attualmente presente. Continuare?")) {
              return;
          }
      }
      
      if (pendingMoveData.sourceTurnoId === destTurnoId && pendingMoveData.sourceRoleKey === destRoleKey) {
          alert("Origine e destinazione coincidono.");
          cancelMove();
          closeMoveDestModal();
          return;
      }

      try {
          closeMoveDestModal();
          const banner = document.getElementById('dynamic-move-banner');
          if (banner) banner.innerHTML = '<div style="padding: 10px;">🔄 Spostamento transazionale in corso... attendere.</div>';
          
          await runTransaction(db, async (transaction) => {
              const sourceRef = doc(db, "turni", pendingMoveData.sourceTurnoId);
              const destRef = doc(db, "turni", destTurnoId);
              
              const sourceSnap = await transaction.get(sourceRef);
              if (!sourceSnap.exists()) throw "Il turno di origine non esiste più.";
              
              const destSnap = (pendingMoveData.sourceTurnoId === destTurnoId) ? sourceSnap : await transaction.get(destRef);
              if (!destSnap.exists()) throw "Il turno di destinazione non esiste più.";
              
              const sourceData = sourceSnap.data();
              const destData = destSnap.data();
              
              const sourceEq = sourceData.equipaggio_attuale || {};
              const destEq = destData.equipaggio_attuale || {};
              
              if (sourceEq[pendingMoveData.sourceRoleKey]?.matricola !== pendingMoveData.volunteer.matricola) {
                  throw "ERRORE_ORIGINE";
              }
              
              if (!destWasOccupied && destEq[destRoleKey]?.matricola) {
                  throw "SLOT_OCCUPATO";
              }
              
              const newSourceEq = { ...sourceEq };
              newSourceEq[pendingMoveData.sourceRoleKey] = { matricola: null, nominativo: null, convalidato_da_admin: false };
              
              const newDestEq = (pendingMoveData.sourceTurnoId === destTurnoId) ? newSourceEq : { ...destEq };
              newDestEq[destRoleKey] = {
                  matricola: pendingMoveData.volunteer.matricola,
                  nominativo: pendingMoveData.volunteer.nominativo,
                  convalidato_da_admin: true
              };
              
              const sourceLogs = sourceData.log_modifiche || [];
              sourceLogs.push({
                  timestamp: new Date().toISOString(),
                  autore: currentAdminUser.matricola,
                  azione: `Spostamento in uscita verso turno ${destData.data} (${destData.orario?.inizio || ''})`,
                  notifica_inviata: false
              });
              
              const destLogs = destData.log_modifiche || [];
              destLogs.push({
                  timestamp: new Date().toISOString(),
                  autore: currentAdminUser.matricola,
                  azione: `Spostamento in ingresso dal turno ${sourceData.data} (${sourceData.orario?.inizio || ''})`,
                  notifica_inviata: false
              });

              if (pendingMoveData.sourceTurnoId === destTurnoId) {
                  transaction.update(sourceRef, { equipaggio_attuale: newDestEq, log_modifiche: sourceLogs });
              } else {
                  transaction.update(sourceRef, { equipaggio_attuale: newSourceEq, log_modifiche: sourceLogs });
                  transaction.update(destRef, { equipaggio_attuale: newDestEq, log_modifiche: destLogs });
              }
          });
          
          cancelMove();
          
      } catch(e) {
          if (e === "ERRORE_ORIGINE") {
              alert("Errore: Il volontario che stavi cercando di spostare è stato rimosso o modificato da un altro admin nel frattempo.");
          } else if (e === "SLOT_OCCUPATO") {
              alert("Errore: Lo slot di destinazione è stato appena occupato da un altro admin. Operazione annullata.");
          } else {
              console.error(e);
              alert("Si è verificato un errore di rete durante la transazione.");
          }
          cancelMove();
      }
  }

});
