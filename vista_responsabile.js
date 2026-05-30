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
import { getFirestore, collection, getDocs, updateDoc, doc, onSnapshot, query, writeBatch, getDoc } from "firebase/firestore";
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
                  const nomeDisplay = formattaNomeDisplay(membro.nominativo);
                  return membro.convalidato_da_admin 
                      ? `<span style="color:var(--text-main)">${nomeDisplay}</span><br><span style="font-size:0.6rem; color:var(--neon-green);">✓ Conv.</span>`
                      : `<span style="color:var(--text-main)">${nomeDisplay}</span><br><span style="font-size:0.6rem; color:#38bdf8;">⚠ Attesa</span>`;
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
            const turnoObj = turniOriginali.get(idTurno);
            
            if(e.currentTarget.classList.contains('insert')) {
                if(typeof openInsertModal === 'function') openInsertModal(turnoObj);
                return;
            }

            let azione = '';
            if(e.currentTarget.classList.contains('move')) azione = "Spostamento d'ufficio da Admin";
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
    if(!modalRoleSelect.options.length) return;

    const targetRole = modalRoleSelect.value;
    const search = modalSearch.value.toLowerCase().trim();
    console.log("Termine ricerca:", search);
    
    let filtered = allVolunteersCache.filter(v => {
      const r = v.ruolo || '';
      if (targetRole === 'AUT' && r !== 'autista') return false;
      if (targetRole === 'RIF' && r !== 'caposquadra' && r !== 'admin' && r !== 'superadmin') return false;
      if (targetRole === 'SOC' && r !== 'soccorritore') return false;
      if (targetRole === 'ALL' && r !== 'allievo') return false;
      
      if (search) {
        const cognome = String(v.cognome || '').toLowerCase();
        const nome = String(v.nome || '').toLowerCase();
        const matricola = String(v.matricola || '').toLowerCase();
        
        const isMatch = cognome.includes(search) || 
                        nome.includes(search) || 
                        (cognome + ' ' + nome).includes(search) ||
                        matricola.includes(search);
        
        if (!isMatch) return false;
      }
      return true;
    });
    
    filtered = ordinaUtentiAlfabetico(filtered);
    
    modalVolunteersList.innerHTML = '';
    if (filtered.length === 0) {
      modalVolunteersList.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Nessun volontario trovato per questo ruolo.</p>';
      return;
    }
    
    filtered.forEach(u => {
      const div = document.createElement('div');
      div.className = 'volunteer-item';
      div.innerHTML = `
        <div>
          <strong style="color:var(--text-main); font-size:1rem;">${formattaNomeDisplay(u.nominativo || formattaNominativoUtente(u))}</strong><br>
          <span style="font-size:0.75rem; color:var(--text-muted);">${u.ruoli_areu ? (Array.isArray(u.ruoli_areu) ? u.ruoli_areu.join(', ') : u.ruoli_areu) : ''}</span>
        </div>
        <button class="btn" style="padding:0.3rem 0.6rem; font-size:0.8rem; border-color:var(--neon-green); color:var(--neon-green);">Seleziona</button>
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
    
    const updateData = {};
    updateData[`equipaggio_attuale.${field}`] = {
      matricola: user.matricola,
      nominativo: user.nominativo || formattaNominativoUtente(user),
      convalidato_da_admin: true
    };
    
    try {
      modalLoading.style.display = 'block';
      await updateDoc(doc(db, "turni", modalTurnoId), updateData);
      modalLoading.style.display = 'none';
      if(document.getElementById('modal-close')) document.getElementById('modal-close').click();
    } catch(e) {
      modalLoading.style.display = 'none';
      console.error(e);
      alert("Errore durante l'aggiornamento del turno.");
    }
  }

});
