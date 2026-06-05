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
import { formattaNominativoUtente, ordinaUtentiAlfabetico, formattaNomeDisplay, sanificaTurno, calcolaCoperturaRuolo, calcolaBuchiRuolo } from './utils.js';
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
let spostamentoAttivoGlobale = null;
const activeUnsubscribes = {};

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
                // Clean up old temporary window debug hooks if present
                if (window.currentAdminUser) delete window.currentAdminUser;

                // 1. Extract and sanitize all verification tokens
                const rawMatricola = currentAdminUser && currentAdminUser.matricola ? String(currentAdminUser.matricola).trim() : "";
                const safeFiscalCode = currentAdminUser && currentAdminUser.cod_fiscale ? String(currentAdminUser.cod_fiscale).trim().toUpperCase() : "";

                // 2. Multi-possibility evaluation (Matricola variants OR absolute unique Fiscal Code match)
                const isSuper = (
                    rawMatricola === "34" || 
                    rawMatricola === "034" || 
                    parseInt(rawMatricola, 10) === 34 || 
                    safeFiscalCode === "GSTGRG68E03A745K"
                );

                // 3. UI Execution state
                if (isSuper) {
                    currentAdminUser.superadmin = true;
                    if (superadminSection) {
                        superadminSection.style.display = 'block';
                    }
                    if (typeof initSuperadminPanel === "function") {
                        initSuperadminPanel();
                    }
                    console.log("[SUPERADMIN] Omnipresent access granted. Absolute identity verified.");
                } else {
                    if (superadminSection) {
                        superadminSection.style.display = 'none';
                    }
                    console.log("[SUPERADMIN] Access restricted for standard user profile.");
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
      if (activeUnsubscribes.presence) activeUnsubscribes.presence();
      activeUnsubscribes.presence = onSnapshot(presenceQuery, (snap) => {
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
      if (activeUnsubscribes.superadmin) activeUnsubscribes.superadmin();
      activeUnsubscribes.superadmin = onSnapshot(qU, (snapshot) => {
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
                      { val: 'soccorritore', text: 'Operatore DAE (SOC)' },
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
      // =====================================================================
      // PHASE 2: BULLETPROOF GATEKEEPER — multi-criteria isSuper evaluation
      // Covers: matricola "34", legacy "034", parseInt fallback, and Fiscal Code
      // =====================================================================
      const superadminPanel = document.getElementById('superadmin-rules-panel');
      const rawMatricolaCheck = currentAdminUser ? String(currentAdminUser.matricola || '').trim() : '';
      const safeFiscalCodeCheck = currentAdminUser ? String(currentAdminUser.cod_fiscale || '').trim().toUpperCase() : '';
      const isSuperForPanel = (
          rawMatricolaCheck === "34" ||
          rawMatricolaCheck === "034" ||
          parseInt(rawMatricolaCheck, 10) === 34 ||
          safeFiscalCodeCheck === "GSTGRG68E03A745K"
      );

      if (isSuperForPanel) {
          if (superadminPanel) {
              superadminPanel.style.display = 'block';
              // Render plain checkboxes (no .switch dependency) for maximum reliability
              superadminPanel.innerHTML = `
                <div style="padding: 15px; background: rgba(255, 255, 255, 0.03); border: 1px solid #00f2fe; border-radius: 8px; margin-bottom: 15px;">
                    <h4 style="color: #00f2fe; margin: 0 0 10px 0; font-size: 1rem; text-transform: uppercase;">Gestione Vincoli Orari 11h</h4>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <label style="color: #fff;">Blocco 11h VOLONTARI</label>
                        <input type="checkbox" id="toggle-riposo-volontari" style="transform: scale(1.2); cursor: pointer;">
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <label style="color: #fff;">Blocco 11h DIPENDENTI</label>
                        <input type="checkbox" id="toggle-riposo-dipendenti" style="transform: scale(1.2); cursor: pointer;">
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 10px; margin-top: 4px;">
                        <label style="color: #ffcc00; font-size: 0.9rem;">⚠️ Applica regola anche agli Admin</label>
                        <input type="checkbox" id="toggle-regola-admin" style="transform: scale(1.2); cursor: pointer;">
                    </div>
                </div>
              `;
          }

          // Bind to Firestore live listener AFTER innerHTML has been written (elements now exist in DOM)
          const toggleVolontari = document.getElementById('toggle-riposo-volontari');
          const toggleDipendenti = document.getElementById('toggle-riposo-dipendenti');
          const toggleRegoleAdmin = document.getElementById('toggle-regola-admin');

          if (toggleVolontari && toggleDipendenti && toggleRegoleAdmin) {
              if (activeUnsubscribes.regole_riposo) activeUnsubscribes.regole_riposo();
              activeUnsubscribes.regole_riposo = onSnapshot(doc(db, "impostazioni", "regole_riposo"), async (snap) => {
                  if (snap.exists()) {
                      const data = snap.data();
                      toggleVolontari.checked = !!data.controllaRiposoVolontari;
                      toggleDipendenti.checked = !!data.controllaRiposoDipendenti;
                      toggleRegoleAdmin.checked = !!data.applicaRegoleAdmin;
                  } else {
                      // Document doesn't exist yet — initialize with safe defaults
                      await setDoc(doc(db, "impostazioni", "regole_riposo"), {
                          controllaRiposoVolontari: true,
                          controllaRiposoDipendenti: false,
                          applicaRegoleAdmin: false
                      });
                  }
              });

              const updateRules = async () => {
                  try {
                      await updateDoc(doc(db, "impostazioni", "regole_riposo"), {
                          controllaRiposoVolontari: toggleVolontari.checked,
                          controllaRiposoDipendenti: toggleDipendenti.checked,
                          applicaRegoleAdmin: toggleRegoleAdmin.checked
                      });
                  } catch(e) {
                      console.error("Errore update regole riposo", e);
                      alert("Errore durante il salvataggio della configurazione.");
                  }
              };

              toggleVolontari.addEventListener('change', updateRules);
              toggleDipendenti.addEventListener('change', updateRules);
              toggleRegoleAdmin.addEventListener('change', updateRules);
          } else {
              console.warn("[SUPERADMIN] Toggle elements not found after innerHTML inject. Check #superadmin-rules-panel.");
          }
      } else {
          // Non-destructive hide: preserve node in DOM to prevent null crashes on re-render cycles
          if (superadminPanel) {
              superadminPanel.style.display = 'none';
          }
          console.log("[SUPERADMIN] Panel hidden for non-superadmin user.");
      }
  }

  // 3. Tabellone Turni Responsabile
  window.globalUsersMap = {};
  
  function initApp() {
      if (activeUnsubscribes.utentiGlobal) activeUnsubscribes.utentiGlobal();
      activeUnsubscribes.utentiGlobal = onSnapshot(collection(db, "utenti"), (snap) => {
          snap.docs.forEach(d => {
              window.globalUsersMap[d.id] = d.data();
          });
      });

      const q = query(collection(db, "turni")); 
      
      if (activeUnsubscribes.turni) activeUnsubscribes.turni();
      activeUnsubscribes.turni = onSnapshot(q, (snapshot) => {
        turniOriginali.clear();
        snapshot.docs.forEach(docSnap => {
          turniOriginali.set(docSnap.id, sanificaTurno({ id: docSnap.id, ...docSnap.data() }));
        });
        renderTable();
      });

      // Ascolta stato spostamento_attivo per questo admin
      const adminSpostamentoRef = doc(db, "spostamenti_attivi", currentAdminUser.matricola);
      if (activeUnsubscribes.spostamento) activeUnsubscribes.spostamento();
      activeUnsubscribes.spostamento = onSnapshot(adminSpostamentoRef, (snap) => {
          if (snap.exists()) {
              spostamentoAttivoGlobale = snap.data();
              renderBannerAnnulla(spostamentoAttivoGlobale);
          } else {
              spostamentoAttivoGlobale = null;
              rimuoviBannerAnnulla();
          }
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
          
          let stato = turno.stato_turno || 'APERTO';
          const inizioTurno = turno.orario?.inizio || "00:00";
          const fineTurno = turno.orario?.fine || "00:00";
          
          const formatCell = (assegnazioni, richiesto, roleKey) => {
              if (assegnazioni && assegnazioni.length > 0) {
                  let html = '';
                  assegnazioni.forEach((membro) => {
                      const nomeDisplay = formattaNomeDisplay(membro.nominativo);
                      
                      let badgeTag = '<span style="font-weight: bold; font-size: 0.8rem; color: #ffcc00;">[?]</span>';
                      if (window.globalUsersMap) {
                          const mStr = String(membro.matricola);
                          // Try exact match first, then zero-padded/stripped variants
                          const userObj = window.globalUsersMap[mStr]
                              || window.globalUsersMap[parseInt(mStr, 10)]
                              || window.globalUsersMap[mStr.replace(/^0+/, '')]
                              || window.globalUsersMap[mStr.padStart(3, '0')]
                              || null;
                          if (userObj) {
                              const rapporto = (userObj.tipoRapporto || userObj.rapporto || '').toLowerCase();
                              if (rapporto.includes('volontario')) {
                                  badgeTag = '<span style="color: #00f2fe; font-weight: bold; font-size: 0.8rem;">[V]</span>';
                              } else if (rapporto.includes('dipendente')) {
                                  badgeTag = '<span style="color: #ff007f; font-weight: bold; font-size: 0.8rem;">[D]</span>';
                              }
                          }
                      }
                      
                      const nameColor = membro.convalidato_da_admin ? '#32CD32' : '#FFD700';
                      
                      const isAdmin = currentAdminUser?.ruolo === 'admin' || currentAdminUser?.ruolo === 'superadmin' || currentAdminUser?.is_admin === true || currentAdminUser?.superadmin === true;
                      const btnRemoveHtml = isAdmin ? `<button class="admin-remove-vol" data-turno="${turno.id}" data-ruolo="${roleKey}" data-matricola="${membro.matricola}" title="Rimuovi Volontario" style="background:transparent; border:none; cursor:pointer; margin-left:0.3rem; color:var(--neon-red); font-size:1rem; padding:0;">❌</button>` : '';
                      const btnSposHtml = isAdmin && !spostamentoAttivoGlobale ? `<button class="admin-sposta-vol" data-turno="${turno.id}" data-ruolo="${roleKey}" data-matricola="${membro.matricola}" title="Sposta Volontario" style="background:transparent; border:none; cursor:pointer; margin-left:0.3rem; color:var(--neon-orange); font-size:1rem; padding:0;">🔄</button>` : '';
                      const btnEditTimeHtml = isAdmin ? `<button class="admin-edit-time" data-turno="${turno.id}" data-ruolo="${roleKey}" data-inizio="${membro.inizio}" data-fine="${membro.fine}" data-matricola="${membro.matricola}" title="Modifica Orario" style="background:transparent; border:none; cursor:pointer; margin-left:0.3rem; color:#00f2fe; font-size:1rem; padding:0;">✏️</button>` : '';

                      const statusHtml = membro.convalidato_da_admin 
                          ? `<span style="font-size:0.6rem; color:var(--neon-green);">✓ Conv.</span>`
                          : `<span style="font-size:0.6rem; color:#38bdf8;">⚠ Attesa</span>`;
                          
                      html += `<div style="margin-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.2rem;">
                          <span style="color:${nameColor}; font-weight:bold;">${nomeDisplay} ${badgeTag}</span>${btnEditTimeHtml}${btnRemoveHtml}${btnSposHtml}<br>
                          <span style="font-size:0.75rem; color:var(--text-muted);">${membro.inizio}-${membro.fine}</span> ${statusHtml}
                      </div>`;
                  });

                  const buchi = calcolaBuchiRuolo(assegnazioni, inizioTurno, fineTurno);
                  if (buchi.length > 0) {
                      buchi.forEach(b => {
                          html += `<div style="color: var(--neon-orange); font-size: 0.75rem; margin-top: 0.3rem; border: 1px dashed var(--neon-orange); padding: 2px; border-radius: 4px; text-align: center; background: rgba(255, 165, 0, 0.1);">
                            ⚠️ Scoperto: ${b.inizio}-${b.fine}
                          </div>`;
                      });
                  }

                  return html;
              }
              if (!richiesto) return `<em style="color:var(--text-muted); font-size: 0.85rem; opacity: 0.5;">N.D.</em>`;
              
              const isAdmin = currentAdminUser?.ruolo === 'admin' || currentAdminUser?.ruolo === 'superadmin' || currentAdminUser?.is_admin === true || currentAdminUser?.superadmin === true;
              const btnDestHtml = isAdmin && spostamentoAttivoGlobale ? `<br><button class="admin-destina-vol btn" data-turno="${turno.id}" data-ruolo="${roleKey}" title="Destina Qui" style="padding: 0.2rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-green); color:var(--neon-green); margin-top: 0.2rem; background: rgba(0,255,0,0.1);">Destina qui</button>` : '';
              
              return `<em style="color:var(--neon-red); font-size: 0.85rem;">Vuoto</em>${btnDestHtml}`;
          };

          const autistaFull = !req.autista_richiesto || calcolaCoperturaRuolo(eq.autista, inizioTurno, fineTurno).isFull;
          const referenteFull = !req.referente_richiesto || calcolaCoperturaRuolo(eq.referente_soreu, inizioTurno, fineTurno).isFull;
          const soccorritoreFull = !req.soccorritore_richiesto || calcolaCoperturaRuolo(eq.soccorritore, inizioTurno, fineTurno).isFull;
          
          if (!autistaFull || !referenteFull || !soccorritoreFull) { 
            stato = 'INCOMPLETO'; 
          }
          else if (stato !== 'CONVALIDATO') { 
            stato = 'COMPLETO'; 
          }
          let badgeClass = (stato === 'COMPLETO' || stato === 'CONVALIDATO') ? 'pieno' : 'critico';

          const dateObj = new Date(turno.data);
          const fDate = dateObj.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' });

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

          const ruoliOrdinati = [
              { key: 'autista', reqVal: req.autista_richiesto },
              { key: 'referente_soreu', reqVal: req.referente_richiesto },
              { key: 'soccorritore', reqVal: req.soccorritore_richiesto },
              { key: 'allievo_quarto_posto', reqVal: req.allievo_consentito }
          ];
          const celleRuoliHtml = ruoliOrdinati.map(r => `<td>${formatCell(eq[r.key], r.reqVal, r.key)}</td>`).join('');

          tr.innerHTML = `
            <td>${squadraHtml}</td>
            <td><strong style="color: var(--text-main); font-size: 1.1rem;">${fDate}</strong><br><span style="font-size:0.85rem; color:var(--text-muted)">${turno.orario?.inizio || ''}-${turno.orario?.fine || ''}</span></td>
            <td><span class="badge ${badgeClass}" style="font-size: 0.65rem;">${stato}</span></td>
            ${celleRuoliHtml}
            <td style="display:flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; justify-content: center; min-width: 110px;">
              <button class="btn action-btn insert" data-id="${turno.id}" style="padding: 0.3rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-green)">➕ Ins.</button>
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
                const matricola = e.currentTarget.getAttribute('data-matricola');
                await rimuoviVolontarioImprevisto(idTurno, ruolo, matricola);
            });
        });

        document.querySelectorAll('.admin-sposta-vol').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idTurno = e.currentTarget.getAttribute('data-turno');
                const ruolo = e.currentTarget.getAttribute('data-ruolo');
                const matricola = e.currentTarget.getAttribute('data-matricola');
                await gestisciClickSpostamento(idTurno, ruolo, matricola);
            });
        });

        document.querySelectorAll('.admin-destina-vol').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idTurno = e.currentTarget.getAttribute('data-turno');
                const ruolo = e.currentTarget.getAttribute('data-ruolo');
                await gestisciClickDestinazione(idTurno, ruolo);
            });
        });

        document.querySelectorAll('.admin-edit-time').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idTurno = e.currentTarget.getAttribute('data-turno');
                const ruolo = e.currentTarget.getAttribute('data-ruolo');
                const inizio = e.currentTarget.getAttribute('data-inizio');
                const fineAttuale = e.currentTarget.getAttribute('data-fine');
                await modificaOrarioAdmin(idTurno, ruolo, inizio, fineAttuale);
            });
        });

        attachActionListeners();
      };

      const modificaOrarioAdmin = async (idTurno, ruolo, inizioSelezionato, fineAttuale) => {
        const nuovaFine = prompt(`Modifica orario FINE per questo slot (Inizio: ${inizioSelezionato}):`, fineAttuale);
        if (!nuovaFine) return;
        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nuovaFine.trim())) {
            alert("Formato non valido! Usa HH:MM (es. 19:00)");
            return;
        }
        try {
            const docRef = doc(db, "turni", idTurno);
            await runTransaction(db, async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists()) throw "Turno non trovato";
                let equipaggio = snap.data().equipaggio_attuale || {};
                if (equipaggio[ruolo] && !Array.isArray(equipaggio[ruolo])) {
                    equipaggio[ruolo] = Object.values(equipaggio[ruolo]).filter(v => v && typeof v === 'object' && v.matricola);
                }
                if (equipaggio[ruolo]) {
                    equipaggio[ruolo] = equipaggio[ruolo].map(m => {
                        if (m.inizio === inizioSelezionato) {
                            return { ...m, fine: nuovaFine.trim() };
                        }
                        return m;
                    });
                }
                transaction.update(docRef, { equipaggio_attuale: equipaggio });
            });
            console.log(`[ADMIN] Orario fine aggiornato a ${nuovaFine} per slot ${ruolo} inizio ${inizioSelezionato}`);
        } catch (err) {
            console.error("Errore modifica orario admin:", err);
            alert("Errore nell'aggiornamento: " + err);
        }
      };

      const rimuoviVolontarioImprevisto = async (idTurno, ruolo, matricola) => {
        if(!confirm("Sei sicuro di voler rimuovere il volontario dal turno?")) return;
        
        console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Rimozione imprevista da ${idTurno} ruolo ${ruolo}`);

        try {
            const docRef = doc(db, "turni", idTurno);
            
            await runTransaction(db, async (transaction) => {
                const turnoSnap = await transaction.get(docRef);
                if (!turnoSnap.exists()) throw "Il turno non esiste più nel database.";
                
                const turnoDataRaw = turnoSnap.data();
                const turnoData = sanificaTurno({ ...turnoDataRaw, orario: turnoDataRaw.orario || { inizio: "00:00", fine: "00:00" } });
                const eq = { ...turnoData.equipaggio_attuale };
                
                if (eq[ruolo]) {
                    eq[ruolo] = eq[ruolo].filter(a => a.matricola !== matricola);
                }

                const logs = turnoData.log_modifiche || [];
                logs.push({
                    timestamp: new Date().toISOString(),
                    autore: currentAdminUser.matricola,
                    azione: `Rimozione imprevista admin per slot ${ruolo.replace(/_/g, ' ')}`,
                    notifica_inviata: false
                });

                console.log(`[DEBUG_DB] DATA_INVIO: Dati transazione calcolati per rimozione imprevista`);

                transaction.update(docRef, {
                    equipaggio_attuale: eq,
                    log_modifiche: logs
                });
            });
            
            console.log(`[DEBUG_DB] CONFERMA_FIRESTORE: Rimozione imprevista confermata da DB`);
        } catch (err) {
            console.error("Errore rimozione:", err);
            alert(typeof err === "string" ? err : "Si è verificato un errore di rete durante la rimozione.");
        }
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
            if(e.currentTarget.classList.contains('validate')) azione = 'Convalida equipaggio da Admin';

            const currentEq = turnoObj.equipaggio_attuale || {};
            
            let payloadModifica = null;
            let nuovoStatoTurno = turnoObj.stato_turno;

            if (azione.includes('Convalida')) {
                // Imposta convalidato_da_admin = true a tutti
                const validatedEq = { ...currentEq };
                ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                    if (validatedEq[r]) {
                        validatedEq[r] = validatedEq[r].map(a => ({ ...a, convalidato_da_admin: true }));
                    }
                });
                nuovoStatoTurno = 'CONVALIDATO';
                payloadModifica = { nuovoEquipaggio: validatedEq, nuovoStato: nuovoStatoTurno };
            } else {
                // Esempio Mock
                payloadModifica = {
                    nuovoEquipaggio: {
                        ...currentEq,
                        autista: azione.includes('Inserimento') ? { matricola: 'ADM01', nominativo: 'Volontario (Admin)', convalidato_da_admin: true } : 
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
        
        console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Salvataggio massivo batch`);

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

            console.log(`[DEBUG_DB] DATA_INVIO: Esecuzione batch.commit()`);
            await batch.commit();
            console.log(`[DEBUG_DB] CONFERMA_FIRESTORE: Batch completato`);

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
      
      // LOGICA SPOSTAMENTO STATE-DRIVEN
      const gestisciClickSpostamento = async (idTurno, ruolo, matricola) => {
          const turnoObj = turniOriginali.get(idTurno);
          if (!turnoObj) return;
          const vol = turnoObj.equipaggio_attuale?.[ruolo]?.find(a => a.matricola === matricola);
          if (!vol) return;

          try {
              const docRef = doc(db, "spostamenti_attivi", currentAdminUser.matricola);
              await setDoc(docRef, {
                  sourceTurnoId: idTurno,
                  sourceTurnoDataStr: turnoObj.data + ' (' + (turnoObj.orario?.inizio || '') + ')',
                  sourceRoleKey: ruolo,
                  volunteer: vol,
                  timestamp: new Date().toISOString()
              });
          } catch(err) {
              console.error("Errore salvataggio spostamento_attivo:", err);
              alert("Errore di rete durante l'inizializzazione dello spostamento.");
          }
      };

      const gestisciClickDestinazione = async (idTurnoDest, ruoloDest) => {
          if (!spostamentoAttivoGlobale) return;
          
          if (spostamentoAttivoGlobale.sourceTurnoId === idTurnoDest && spostamentoAttivoGlobale.sourceRoleKey === ruoloDest) {
              alert("Origine e destinazione coincidono.");
              return;
          }

          console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Spostamento verso turno ${idTurnoDest} ruolo ${ruoloDest}`);

          try {
              const docRefState = doc(db, "spostamenti_attivi", currentAdminUser.matricola);
              
              await runTransaction(db, async (transaction) => {
                  const sourceRef = doc(db, "turni", spostamentoAttivoGlobale.sourceTurnoId);
                  const destRef = doc(db, "turni", idTurnoDest);
                  
                  const sourceSnap = await transaction.get(sourceRef);
                  if (!sourceSnap.exists()) throw "Il turno di origine non esiste più.";
                  
                  const destSnap = (spostamentoAttivoGlobale.sourceTurnoId === idTurnoDest) ? sourceSnap : await transaction.get(destRef);
                  if (!destSnap.exists()) throw "Il turno di destinazione non esiste più.";
                  
                  const sourceDataRaw = sourceSnap.data();
                  const destDataRaw = destSnap.data();
                  const sourceData = sanificaTurno({ ...sourceDataRaw, orario: sourceDataRaw.orario || { inizio: "00:00", fine: "00:00" } });
                  const destData = sanificaTurno({ ...destDataRaw, orario: destDataRaw.orario || { inizio: "00:00", fine: "00:00" } });
                  
                  const sourceEq = sourceData.equipaggio_attuale || {};
                  const destEq = destData.equipaggio_attuale || {};
                  
                  if (!sourceEq[spostamentoAttivoGlobale.sourceRoleKey] || !sourceEq[spostamentoAttivoGlobale.sourceRoleKey].some(a => a.matricola === spostamentoAttivoGlobale.volunteer.matricola)) {
                      throw "ERRORE_ORIGINE";
                  }
                  
                  // Avoid overlap check for now during manual move, just append
                  
                  const newSourceEq = { ...sourceEq };
                  newSourceEq[spostamentoAttivoGlobale.sourceRoleKey] = newSourceEq[spostamentoAttivoGlobale.sourceRoleKey].filter(a => a.matricola !== spostamentoAttivoGlobale.volunteer.matricola);
                  
                  const newDestEq = (spostamentoAttivoGlobale.sourceTurnoId === idTurnoDest) ? newSourceEq : { ...destEq };
                  const destRuolo = newDestEq[ruoloDest] || [];
                  newDestEq[ruoloDest] = [...destRuolo, {
                      ...spostamentoAttivoGlobale.volunteer,
                      convalidato_da_admin: true
                  }];
                  
                  const sourceLogs = sourceData.log_modifiche || [];
                  sourceLogs.push({
                      timestamp: new Date().toISOString(),
                      autore: currentAdminUser.matricola,
                      azione: `Spostamento in uscita verso turno ${destData.data} (${destData.orario?.inizio || ''}) - slot ${ruoloDest}`,
                      notifica_inviata: false
                  });
                  
                  const destLogs = destData.log_modifiche || [];
                  if (spostamentoAttivoGlobale.sourceTurnoId !== idTurnoDest) {
                      destLogs.push({
                          timestamp: new Date().toISOString(),
                          autore: currentAdminUser.matricola,
                          azione: `Spostamento in ingresso dal turno ${sourceData.data} (${sourceData.orario?.inizio || ''}) - slot ${spostamentoAttivoGlobale.sourceRoleKey}`,
                          notifica_inviata: false
                      });
                  }

                  if (spostamentoAttivoGlobale.sourceTurnoId === idTurnoDest) {
                      transaction.update(sourceRef, { equipaggio_attuale: newDestEq, log_modifiche: sourceLogs });
                  } else {
                      transaction.update(sourceRef, { equipaggio_attuale: newSourceEq, log_modifiche: sourceLogs });
                      transaction.update(destRef, { equipaggio_attuale: newDestEq, log_modifiche: destLogs });
                  }
                  // Elimina stato
                  transaction.delete(docRefState);
                  console.log(`[DEBUG_DB] DATA_INVIO: Transazione calcolata per spostamento`);
              });
              
              console.log(`[DEBUG_DB] CONFERMA_FIRESTORE: Spostamento completato in DB`);
          } catch(e) {
              if (e === "ERRORE_ORIGINE") {
                  alert("Errore: Il volontario che stavi cercando di spostare è stato rimosso o modificato da un altro admin nel frattempo.");
              } else if (e === "SLOT_OCCUPATO") {
                  alert("Errore: Lo slot di destinazione è stato appena occupato da un altro admin. Operazione annullata.");
              } else {
                  console.error(e);
                  alert("Si è verificato un errore di rete durante la transazione.");
              }
              // Pulisci lo stato in caso di errore
              await deleteDoc(doc(db, "spostamenti_attivi", currentAdminUser.matricola)).catch(()=>{});
          }
      };

      const renderBannerAnnulla = (spostamentoData) => {
          rimuoviBannerAnnulla();
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
            <span style="font-size: 1.2rem;">🔄 Stai spostando <span style="color: #fff; text-decoration: underline;">${spostamentoData.volunteer.nominativo}</span> dal turno del <span style="color: #fff;">${spostamentoData.sourceTurnoDataStr}</span>.</span><br>
            <span style="font-size: 0.95rem; opacity: 0.9;">Clicca sul tasto 'Destina qui' di uno slot vuoto per incollarlo, oppure</span>
            <button id="dynamic-btn-cancel-move" class="btn" style="background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 0.3rem 0.8rem; margin-left: 10px; font-size: 0.8rem;">Annulla Spostamento</button>
          `;
          
          document.body.appendChild(banner);
          document.getElementById('dynamic-btn-cancel-move').addEventListener('click', async () => {
              try {
                  await deleteDoc(doc(db, "spostamenti_attivi", currentAdminUser.matricola));
              } catch(e) {}
          });
      };

      const rimuoviBannerAnnulla = () => {
          const banner = document.getElementById('dynamic-move-banner');
          if (banner) banner.remove();
      };
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
    const inizioTurno = turnoObj.orario?.inizio || "00:00";
    const fineTurno = turnoObj.orario?.fine || "00:00";
    
    const options = [];
    
    const addRoleOptions = (reqFlag, field, label) => {
        if (!reqFlag) return;
        const slots = eq[field] || [];
        const buchi = calcolaBuchiRuolo(slots, inizioTurno, fineTurno);
        if (buchi.length > 0) {
            buchi.forEach((buco, idx) => {
                options.push({
                    val: field + '_' + idx,
                    label: `${label} (Gap: ${buco.inizio}-${buco.fine})`,
                    field: field,
                    inizio: buco.inizio,
                    fine: buco.fine,
                    occ: false
                });
            });
        } else {
            options.push({
                val: field + '_full',
                label: `${label} (Completo)`,
                field: field,
                inizio: inizioTurno,
                fine: fineTurno,
                occ: true
            });
        }
    };

    addRoleOptions(req.autista_richiesto, 'autista', 'Autista');
    addRoleOptions(req.referente_richiesto, 'referente_soreu', 'Referente SOREU');
    addRoleOptions(req.soccorritore_richiesto, 'soccorritore', 'Operatore DAE');
    addRoleOptions(req.allievo_consentito, 'allievo_quarto_posto', 'Allievo');
    
    if(options.length === 0) {
      alert("Questo turno non ha requisiti configurati.");
      return;
    }

    options.forEach(opt => {
      const status = opt.occ ? '(Occupato - Aggiungi Cmq)' : '(Libero)';
      modalRoleSelect.innerHTML += `<option value="${opt.val}" data-field="${opt.field}" data-inizio="${opt.inizio}" data-fine="${opt.fine}">${opt.label} ${status}</option>`;
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
    const startGap = selectedOption.getAttribute('data-inizio');
    const endGap = selectedOption.getAttribute('data-fine');
    const isOccupied = selectedOption.text.includes('(Occupato');
    
    if (isOccupied) {
      if (!confirm("Questo ruolo è già completamente coperto. Vuoi comunque aggiungere questo volontario?")) return;
    }

    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Inserimento da modale per ${modalTurnoId} ruolo ${field}`);
    
    try {
      modalLoading.style.display = 'block';
      
      await runTransaction(db, async (transaction) => {
          const turnoRef = doc(db, "turni", modalTurnoId);
          const turnoSnap = await transaction.get(turnoRef);
          
          if (!turnoSnap.exists()) {
              throw "Il turno non esiste più.";
          }
          
          const turnoDataRaw = turnoSnap.data();
          const turnoData = sanificaTurno({ ...turnoDataRaw, orario: turnoDataRaw.orario || { inizio: "00:00", fine: "00:00" } });
          const currentEq = turnoData.equipaggio_attuale || {};
          
          // Se stavamo inserendo in uno slot originariamente libero, ma ora è occupato, blocchiamo
          // Nota: potremmo usare calcolaCoperturaRuolo per essere più precisi, ma in caso di array accodiamo
          const fieldArray = Array.isArray(currentEq[field]) ? currentEq[field] : Object.values(currentEq[field] || {});
          
          const newEq = { ...currentEq };
          newEq[field] = [
              ...fieldArray,
              {
                  matricola: user.matricola,
                  nominativo: user.nominativo || formattaNominativoUtente(user),
                  inizio: startGap,
                  fine: endGap,
                  convalidato_da_admin: true
              }
          ];
          
          console.log(`[DEBUG_DB] DATA_INVIO: Transazione modale pronta`);
          transaction.update(turnoRef, { equipaggio_attuale: newEq });
      });
      
      console.log(`[DEBUG_DB] CONFERMA_FIRESTORE: Modifica modale completata`);
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
});
