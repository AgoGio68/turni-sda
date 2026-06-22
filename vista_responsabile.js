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
import { getFirestore, collection, getDocs, updateDoc, doc, onSnapshot, query, writeBatch, getDoc, runTransaction, setDoc, deleteDoc, arrayUnion, where } from "firebase/firestore";
import { formattaNominativoUtente, ordinaUtentiAlfabetico, formattaNomeDisplay, sanificaTurno, calcolaCoperturaRuolo, calcolaBuchiRuolo, timeToMinutes } from './utils.js';

function checkTimeOverlap(shiftStart, shiftEnd, availStart, availEnd) {
    let sStart = timeToMinutes(shiftStart);
    let sEnd = timeToMinutes(shiftEnd);
    if (sEnd <= sStart) sEnd += 24 * 60;

    let aStart = timeToMinutes(availStart);
    let aEnd = timeToMinutes(availEnd);
    
    if (aStart < 12 * 60 && sStart > 12 * 60) aStart += 24 * 60;
    if (aEnd <= aStart) aEnd += 24 * 60;

    const maxStart = Math.max(sStart, aStart);
    const minEnd = Math.min(sEnd, aEnd);
    return maxStart < minEnd;
}

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
window.turniOriginali = turniOriginali;
let disponibilitaList = []; // Lista disponibilità volontari
let currentAdminUser = null;
let recentlyUpdatedRoles = new Set();
let spostamentoAttivoGlobale = null;
const activeUnsubscribes = {};

const stagingBar = document.getElementById('staging-bar');
const stagingCount = document.getElementById('staging-count');
const tbody = document.querySelector('#admin-table tbody');

const adminInfoDiv = document.getElementById('admin-info');
const activeAdminsDiv = document.getElementById('active-admins');
const superadminSection = document.getElementById('superadmin-section');
const superadminHeader = document.getElementById('superadmin-toggle-header');
const superadminContent = document.getElementById('superadmin-content');
const superadminBtn = document.getElementById('btn-toggle-superadmin');

if (superadminHeader) {
    superadminHeader.addEventListener('click', () => {
        if (superadminContent.style.display === 'none') {
            superadminContent.style.display = 'block';
            superadminBtn.innerHTML = '🔼 Chiudi Pannello';
        } else {
            superadminContent.style.display = 'none';
            superadminBtn.innerHTML = '🔽 Apri Pannello';
        }
    });
}
const superadminTbody = document.querySelector('#superadmin-table tbody');
const adminInfo = document.getElementById('admin-info');

// Utility: sanitizza testo per prevenire XSS nell'innerHTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  
  // 1. RBAC & Firebase Auth — SEMPRE tramite onAuthStateChanged, nessun bypass

  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        const matricola = user.email.split('@')[0];
        
        // Controllo Superadmin AgoGio (verificato tramite Firebase Auth, nessun bypass)
        if (matricola.toLowerCase() === 'agogio') {
            currentAdminUser = { matricola: '034', nome: 'Giorgio', cognome: 'Agostini', is_admin: true, superadmin: true };
            adminInfo.innerHTML = `Admin: SUPERADMIN <a href="vista_volontario.html?no_redirect=true" class="btn-link" style="margin-left:1rem; margin-right:1rem; color:var(--neon-green); font-size:0.8rem; text-decoration:none; border: 1px solid var(--neon-green); padding: 2px 6px; border-radius: 4px; background: rgba(57,255,20,0.1);">Vista Volontario</a><a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
            document.getElementById('logout-btn').addEventListener('click', () => {
                signOut(auth);
                window.location.href = "index.html";
            });
            
            superadminSection.style.display = 'block';
            initSuperadminPanel();
            initApp();
            registerAdminNotifications('agogio');
        } else {
            // Controllo Admin normale (Volontario con is_admin: true)
            const snap = await getDoc(doc(db, "utenti", matricola));
            if (snap.exists() && snap.data().is_admin) {
                currentAdminUser = snap.data();
                // Clean up old temporary window debug hooks if present
                if (window.currentAdminUser) delete window.currentAdminUser;

                // Verifica superadmin dal campo Firestore o dal login noto
                const rawMatricola = currentAdminUser && currentAdminUser.matricola ? String(currentAdminUser.matricola).trim() : "";

                // Superadmin determinato da Firestore field oppure da matricola nota (senza PII nel client)
                const isSuper = !!snap.data().superadmin || rawMatricola === "34" || rawMatricola === "034";

                // 3. UI Execution state
                if (isSuper) {
                    currentAdminUser.superadmin = true;
                    // Mostra la sezione se ha i permessi per vederla
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
                
                let notifyBtnHTML = "";
                if (window.Notification && Notification.permission !== "granted") {
                    notifyBtnHTML = `<button id="btn-enable-notifications" class="btn" style="margin-left:1rem; padding:0.3rem 0.6rem; font-size:0.8rem; border-color:var(--neon-orange); color:var(--neon-orange); background:rgba(255,153,0,0.1); border-style:dashed;">🔔 Attiva Notifiche</button>`;
                }

                adminInfo.innerHTML = `Admin: ${formattaNomeDisplay(currentAdminUser.nominativo || formattaNominativoUtente(currentAdminUser))} ${notifyBtnHTML} <a href="vista_volontario.html?no_redirect=true" class="btn-link" style="margin-left:1rem; margin-right:1rem; color:var(--neon-green); font-size:0.8rem; text-decoration:none; border: 1px solid var(--neon-green); padding: 2px 6px; border-radius: 4px; background: rgba(57,255,20,0.1);">Vista Volontario</a><a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
                document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

                if (document.getElementById('btn-enable-notifications')) {
                    document.getElementById('btn-enable-notifications').addEventListener('click', async () => {
                        const btn = document.getElementById('btn-enable-notifications');
                        btn.disabled = true;
                        btn.textContent = "Attivazione...";
                        try {
                            await window.AppMessaging.requestNotificationPermissions(currentAdminUser.matricola);
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            if (Notification.permission === "granted") {
                                btn.style.display = "none";
                                alert("Notifiche attivate con successo per questo dispositivo!");
                            } else {
                                btn.disabled = false;
                                btn.textContent = "🔔 Attiva Notifiche";
                                alert("Permesso notifiche non concesso. Se hai già bloccato le notifiche, abilitale manualmente nelle impostazioni del tuo iPhone per questa app.");
                            }
                        } catch (err) {
                            console.error(err);
                            btn.disabled = false;
                            btn.textContent = "🔔 Attiva Notifiche";
                            alert("Errore durante l'attivazione: " + err.message);
                        }
                    });
                }
                
                initApp();
                initPresence();
                registerAdminNotifications(currentAdminUser.matricola);
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

  function registerAdminNotifications(matricola) {
      if (!matricola) return;
      if (window.AppMessaging && window.AppMessaging.requestNotificationPermissions) {
          window.AppMessaging.requestNotificationPermissions(matricola);
          window.AppMessaging.listenInForeground();
      } else {
          const checkMsg = setInterval(() => {
              if (window.AppMessaging && window.AppMessaging.requestNotificationPermissions) {
                  window.AppMessaging.requestNotificationPermissions(matricola);
                  window.AppMessaging.listenInForeground();
                  clearInterval(checkMsg);
              }
          }, 500);
          setTimeout(() => clearInterval(checkMsg), 10000);
      }
  }
  
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
      // PHASE 2: Superadmin panel gating — basato sul flag calcolato a login
      // =====================================================================
      const superadminPanel = document.getElementById('superadmin-rules-panel');
      const isSuperForPanel = !!(currentAdminUser && currentAdminUser.superadmin);

      if (isSuperForPanel) {
          if (superadminPanel) {
              superadminPanel.style.display = 'block';
              // Render plain checkboxes and dropdown for maximum reliability
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
                <div style="padding: 15px; background: rgba(255, 255, 255, 0.03); border: 1px solid #00ffcc; border-radius: 8px; margin-bottom: 15px; margin-top: 15px;">
                    <h4 style="color: #00ffcc; margin: 0 0 10px 0; font-size: 1rem; text-transform: uppercase;">Configurazione Promemoria Turni</h4>
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <label style="color: #fff; font-size: 0.95rem;">Giorni di preavviso per reminder</label>
                        <select id="select-reminder-giorni" style="background: #1a1a24; color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px; font-size: 0.9rem; outline: none; cursor: pointer; width: 150px;">
                            <option value="1">1 giorno prima (Default)</option>
                            <option value="2">2 giorni prima</option>
                            <option value="3">3 giorni prima</option>
                            <option value="4">4 giorni prima</option>
                            <option value="5">5 giorni prima</option>
                        </select>
                    </div>
                </div>
                <div style="padding: 15px; background: rgba(255, 255, 255, 0.03); border: 1px solid #ff0055; border-radius: 8px; margin-top: 15px;">
                    <h4 style="color: #ff0055; margin: 0 0 10px 0; font-size: 1rem; text-transform: uppercase;">⚠️ Area Pericolosa (Solo Test)</h4>
                    <p style="font-size: 0.8rem; color: #aaa; margin: 0 0 12px 0;">Cancella in modo permanente tutti i dati dei turni o lo storico dei messaggi. Operazione non annullabile.</p>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="btn" id="btn-svuota-turni" style="border-color: #ff0055; color: #ff0055; background: rgba(255,0,85,0.1); padding: 0.4rem 0.8rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer;">Svuota Tutti i Turni</button>
                        <button class="btn" id="btn-svuota-comunicazioni" style="border-color: #ff0055; color: #ff0055; background: rgba(255,0,85,0.1); padding: 0.4rem 0.8rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer;">Svuota Storico Messaggi</button>
                    </div>
                </div>
              `;
          }

          // Bind to Firestore live listener AFTER innerHTML has been written (elements now exist in DOM)
          const toggleVolontari = document.getElementById('toggle-riposo-volontari');
          const toggleDipendenti = document.getElementById('toggle-riposo-dipendenti');
          const toggleRegoleAdmin = document.getElementById('toggle-regola-admin');
          const selectReminderGiorni = document.getElementById('select-reminder-giorni');
          const btnSvuotaTurni = document.getElementById('btn-svuota-turni');
          const btnSvuotaComunicazioni = document.getElementById('btn-svuota-comunicazioni');

          if (toggleVolontari && toggleDipendenti && toggleRegoleAdmin && selectReminderGiorni) {
              if (activeUnsubscribes.regole_riposo) activeUnsubscribes.regole_riposo();
              activeUnsubscribes.regole_riposo = onSnapshot(doc(db, "impostazioni", "regole_riposo"), async (snap) => {
                  if (snap.exists()) {
                      const data = snap.data();
                      toggleVolontari.checked = !!data.controllaRiposoVolontari;
                      toggleDipendenti.checked = !!data.controllaRiposoDipendenti;
                      toggleRegoleAdmin.checked = !!data.applicaRegoleAdmin;
                      selectReminderGiorni.value = String(data.giorniPreavvisoReminder || 1);
                  } else {
                      // Document doesn't exist yet — initialize with safe defaults
                      try {
                          await setDoc(doc(db, "impostazioni", "regole_riposo"), {
                              controllaRiposoVolontari: true,
                              controllaRiposoDipendenti: false,
                              applicaRegoleAdmin: false,
                              giorniPreavvisoReminder: 1
                          });
                      } catch (initErr) {
                          console.error("Errore inizializzazione impostazioni:", initErr);
                      }
                  }
              });

              const updateRules = async () => {
                  try {
                      await updateDoc(doc(db, "impostazioni", "regole_riposo"), {
                          controllaRiposoVolontari: toggleVolontari.checked,
                          controllaRiposoDipendenti: toggleDipendenti.checked,
                          applicaRegoleAdmin: toggleRegoleAdmin.checked,
                          giorniPreavvisoReminder: parseInt(selectReminderGiorni.value, 10) || 1
                      });
                  } catch(e) {
                      console.error("Errore update regole riposo", e);
                      alert("Errore durante il salvataggio della configurazione.");
                  }
              };

              toggleVolontari.addEventListener('change', updateRules);
              toggleDipendenti.addEventListener('change', updateRules);
              toggleRegoleAdmin.addEventListener('change', updateRules);
              selectReminderGiorni.addEventListener('change', updateRules);
          } else {
              console.warn("[SUPERADMIN] Toggle elements not found after innerHTML inject. Check #superadmin-rules-panel.");
          }

          if (btnSvuotaTurni) {
              btnSvuotaTurni.addEventListener('click', async () => {
                  if (!confirm("⚠️ ATTENZIONE! Questa operazione CANCELLERÀ TUTTI I TURNI presenti nel database. Vuoi procedere?")) return;
                  if (!confirm("Sei ASSOLUTAMENTE sicuro? Questa operazione è irreversibile e cancellerà definitivamente tutti i turni.")) return;
                  
                  try {
                      btnSvuotaTurni.disabled = true;
                      btnSvuotaTurni.innerHTML = "Eliminazione...";
                      const snap = await getDocs(collection(db, "turni"));
                      await Promise.all(snap.docs.map(docSnap => deleteDoc(docSnap.ref)));
                      alert("Tutti i turni sono stati cancellati dal database!");
                  } catch (err) {
                      console.error("Errore svuotamento turni:", err);
                      alert("Errore durante lo svuotamento: " + err.message);
                  } finally {
                      btnSvuotaTurni.disabled = false;
                      btnSvuotaTurni.innerHTML = "Svuota Tutti i Turni";
                  }
              });
          }

          if (btnSvuotaComunicazioni) {
              btnSvuotaComunicazioni.addEventListener('click', async () => {
                  if (!confirm("⚠️ ATTENZIONE! Questa operazione CANCELLERÀ TUTTO LO STORICO MESSAGGI e comunicazioni. Vuoi procedere?")) return;
                  if (!confirm("Sei ASSOLUTAMENTE sicuro? I messaggi andranno persi per sempre.")) return;
                  
                  try {
                      btnSvuotaComunicazioni.disabled = true;
                      btnSvuotaComunicazioni.innerHTML = "Eliminazione...";
                      const snap = await getDocs(collection(db, "comunicazioni_turni"));
                      await Promise.all(snap.docs.map(docSnap => deleteDoc(docSnap.ref)));
                      alert("Lo storico comunicazioni è stato svuotato!");
                  } catch (err) {
                      console.error("Errore svuotamento comunicazioni:", err);
                      alert("Errore durante lo svuotamento: " + err.message);
                  } finally {
                      btnSvuotaComunicazioni.disabled = false;
                      btnSvuotaComunicazioni.innerHTML = "Svuota Storico Messaggi";
                  }
              });
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

      if (activeUnsubscribes.disponibilita) activeUnsubscribes.disponibilita();
      activeUnsubscribes.disponibilita = onSnapshot(collection(db, "disponibilita"), (snap) => {
          disponibilitaList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          renderTable();
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
              const dispPerRuolo = disponibilitaList.filter(d => {
                  if (d.data !== turno.data || d.ruolo !== roleKey || d.stato === 'NON_SELEZIONATO') return false;
                  if (!d.orario || !d.orario.inizio || !d.orario.fine) return false;
                  
                  if (assegnazioni && assegnazioni.length > 0) {
                      const buchi = calcolaBuchiRuolo(assegnazioni, inizioTurno, fineTurno);
                      if (buchi.length === 0) return false;
                      return buchi.some(b => checkTimeOverlap(b.inizio, b.fine, d.orario.inizio, d.orario.fine));
                  } else {
                      return checkTimeOverlap(inizioTurno, fineTurno, d.orario.inizio, d.orario.fine);
                  }
              });
              const countDisp = dispPerRuolo.length;

              if (assegnazioni && assegnazioni.length > 0) {
                  let html = '';
                  assegnazioni.forEach((membro) => {
                      const nomeDisplay = formattaNomeDisplay(membro.nominativo);
                      
                      let badgeTag = '<span style="font-weight: bold; font-size: 0.8rem; color: #ffcc00;">[?]</span>';
                      if (window.globalUsersMap) {
                          const mStr = String(membro.matricola);
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
                          : `<span style="font-size:0.6rem; color:#38bdf8;">⚠️ Attesa</span>`;
                          
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
                      if (countDisp > 0) {
                          html += `<div style="margin-top: 0.35rem; text-align: center;"><span class="status-badge" style="background: rgba(0, 255, 204, 0.15); color: #00ffcc; border: 1px solid rgba(0, 255, 204, 0.3); font-weight: bold; font-size: 0.75rem; cursor: pointer; padding: 2px 6px;" onclick="window.openInsertModal('${turno.id}')">🙋 Candidati: ${countDisp}</span></div>`;
                      }
                  }

                  return html;
              }
              if (!richiesto) return `<em style="color:var(--text-muted); font-size: 0.85rem; opacity: 0.5;">N.D.</em>`;
              
              const isAdmin = currentAdminUser?.ruolo === 'admin' || currentAdminUser?.ruolo === 'superadmin' || currentAdminUser?.is_admin === true || currentAdminUser?.superadmin === true;
              const btnDestHtml = isAdmin && spostamentoAttivoGlobale ? `<br><button class="admin-destina-vol btn" data-turno="${turno.id}" data-ruolo="${roleKey}" title="Destina Qui" style="padding: 0.2rem 0.4rem; font-size: 0.7rem; border-color:var(--neon-green); color:var(--neon-green); margin-top: 0.2rem; background: rgba(0,255,0,0.1);">Destina qui</button>` : '';
              
              const dispBadge = countDisp > 0 
                  ? `<br><span class="status-badge" style="background: rgba(0, 255, 204, 0.15); color: #00ffcc; border: 1px solid rgba(0, 255, 204, 0.3); font-weight: bold; font-size: 0.75rem; cursor: pointer; display: inline-block; margin-top: 0.25rem; padding: 2px 6px;" onclick="window.openInsertModal('${turno.id}')">🙋 Candidati: ${countDisp}</span>`
                  : '';
              return `<em style="color:var(--neon-red); font-size: 0.85rem;">Vuoto</em>${dispBadge}${btnDestHtml}`;
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
          
          const nuovaFineClean = String(nuovaFine).trim();
          if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nuovaFineClean)) {
              alert("Formato non valido! Usa HH:MM (es. 19:00)");
              return;
          }

          if (nuovaFineClean === String(fineAttuale).trim()) {
              console.log("[IDEMPOTENCY] Nessuna modifica rilevata. Scrittura annullata.");
              return;
          }

          try {
              const docRef = doc(db, "turni", String(idTurno).trim());
              await runTransaction(db, async (transaction) => {
                  const snap = await transaction.get(docRef);
                  if (!snap.exists()) throw "Turno non trovato";
                  let equipaggio = snap.data().equipaggio_attuale || {};
                  
                  if (equipaggio[ruolo] && !Array.isArray(equipaggio[ruolo])) {
                      equipaggio[ruolo] = Object.values(equipaggio[ruolo]).filter(v => v && typeof v === 'object' && v.matricola);
                  }
                  
                  let changed = false;
                  if (equipaggio[ruolo]) {
                      equipaggio[ruolo] = equipaggio[ruolo].map(m => {
                          if (String(m.inizio).trim() === String(inizioSelezionato).trim()) {
                              if (String(m.fine).trim() !== nuovaFineClean) changed = true;
                              return { 
                                  matricola: String(m.matricola).trim(),
                                  nominativo: String(m.nominativo).trim(),
                                  inizio: String(m.inizio).trim(),
                                  fine: nuovaFineClean,
                                  convalidato_da_admin: !!m.convalidato_da_admin
                              };
                          }
                          return {
                              matricola: String(m.matricola).trim(),
                              nominativo: String(m.nominativo).trim(),
                              inizio: String(m.inizio).trim(),
                              fine: String(m.fine).trim(),
                              convalidato_da_admin: !!m.convalidato_da_admin
                          };
                      });
                  }
                  
                  if (changed) {
                      transaction.update(docRef, { equipaggio_attuale: equipaggio });
                  } else {
                      throw "NESSUNA_MODIFICA";
                  }
              });
              console.log(`[ADMIN] Orario fine aggiornato a ${nuovaFineClean} per slot ${ruolo}`);
          } catch (err) {
              if (err === "NESSUNA_MODIFICA") {
                  console.log("[IDEMPOTENCY] Transazione abortita: valori identici.");
              } else {
                  console.error("Errore modifica orario admin:", err);
                  alert("Errore nell'aggiornamento: " + err);
              }
          }
      };

      const rimuoviVolontarioImprevisto = async (idTurno, ruolo, matricola) => {
        if(!confirm("Sei sicuro di voler rimuovere il volontario dal turno?")) return;
        
        console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Rimozione imprevista da ${idTurno} ruolo ${ruolo}`);

        try {
            const docRef = doc(db, "turni", String(idTurno).trim());
            
            await runTransaction(db, async (transaction) => {
                const turnoSnap = await transaction.get(docRef);
                if (!turnoSnap.exists()) throw "Il turno non esiste più nel database.";
                
                const turnoDataRaw = turnoSnap.data();
                const turnoData = sanificaTurno({ ...turnoDataRaw, orario: turnoDataRaw.orario || { inizio: "00:00", fine: "00:00" } });
                const eq = { ...turnoData.equipaggio_attuale };
                
                if (eq[ruolo]) {
                    eq[ruolo] = eq[ruolo].filter(a => String(a.matricola) !== String(matricola));
                }

                const logEntry = {
                    timestamp: new Date().toISOString(),
                    autore: String(currentAdminUser.matricola).trim(),
                    azione: String(`Rimozione imprevista admin per slot ${ruolo.replace(/_/g, ' ')}`).trim(),
                    notifica_inviata: false
                };

                console.log(`[DEBUG_DB] DATA_INVIO: Dati transazione calcolati per rimozione imprevista`);

                transaction.update(docRef, {
                    equipaggio_attuale: eq,
                    log_modifiche: arrayUnion(logEntry)
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

                // Validazione: Impedisci convalida se ci sono ruoli sovrapposti nello stesso turno
                const seenMatricole = new Set();
                let overlapFound = false;
                let overlapName = "";
                ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                    const slot = validatedEq[r];
                    if (!slot) return;
                    const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
                    slotArr.forEach(m => {
                        if (m && m.matricola) {
                            const matr = String(m.matricola).trim();
                            if (seenMatricole.has(matr)) {
                                overlapFound = true;
                                overlapName = m.nominativo || matr;
                            }
                            seenMatricole.add(matr);
                        }
                    });
                });
                if (overlapFound) {
                    alert(`Impossibile convalidare: Il volontario (${overlapName}) è inserito in più ruoli in questo turno. Rimuovilo da uno dei ruoli prima di procedere.`);
                    return;
                }

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
        
        console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Salvataggio transazionale per ${modificheSospese.length} turni`);

        let successCount = 0;
        let failCount = 0;
        const logNotifiche = [];

        for (const mod of modificheSospese) {
            try {
                const turnoRef = doc(db, "turni", mod.idTurno);
                
                await runTransaction(db, async (transaction) => {
                    // Rileggi il documento dal server per evitare sovrascritture stale
                    const turnoSnap = await transaction.get(turnoRef);
                    if (!turnoSnap.exists()) throw "Il turno non esiste più.";
                    
                    const currentData = turnoSnap.data();
                    const currentEq = currentData.equipaggio_attuale || {};
                    let finalEq;
                    let finalStato = mod.payloadModifica.nuovoStato;

                    if (finalStato === 'CONVALIDATO') {
                        // Convalida: applica convalidato_da_admin a TUTTI i membri attuali (freschi dal server)
                        finalEq = { ...currentEq };
                        ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                            if (finalEq[r] && Array.isArray(finalEq[r])) {
                                finalEq[r] = finalEq[r].map(a => ({ ...a, convalidato_da_admin: true }));
                            }
                        });

                        // Validazione overlap: verifica che nessun volontario sia in 2 ruoli
                        const seenMatricole = new Set();
                        let overlapFound = false;
                        let overlapName = "";
                        ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                            const slot = finalEq[r];
                            if (!slot) return;
                            const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
                            slotArr.forEach(m => {
                                if (m && m.matricola) {
                                    const matr = String(m.matricola).trim();
                                    if (seenMatricole.has(matr)) {
                                        overlapFound = true;
                                        overlapName = m.nominativo || matr;
                                    }
                                    seenMatricole.add(matr);
                                }
                            });
                        });
                        if (overlapFound) throw `Volontario ${overlapName} in più ruoli.`;
                    } else {
                        // Per altre azioni: usa l'equipaggio dalla modifica staged
                        finalEq = mod.payloadModifica.nuovoEquipaggio;
                    }

                    const logEntry = {
                        timestamp: String(mod.timestamp).trim(),
                        autore: String(currentAdminUser.matricola).trim(),
                        azione: String(mod.azione).trim(),
                        notifica_inviata: true
                    };

                    transaction.update(turnoRef, {
                        equipaggio_attuale: finalEq,
                        stato_turno: finalStato,
                        log_modifiche: arrayUnion(logEntry)
                    });
                });

                // Notifiche di convalida (fuori dalla transazione, sono create nuove)
                if (mod.payloadModifica.nuovoStato === 'CONVALIDATO') {
                    // Svuotamento disponibilità in eccesso per la data di questo turno
                    try {
                        const qDisp = query(collection(db, "disponibilita"), where("data", "==", mod.turnoVecchio.data));
                        const snapDisp = await getDocs(qDisp);
                        if (snapDisp.docs.length > 0) {
                            const batchDisp = writeBatch(db);
                            snapDisp.docs.forEach(docDisp => {
                                batchDisp.delete(docDisp.ref);
                            });
                            await batchDisp.commit();
                            console.log(`[DEBUG_DB] Pulite ${snapDisp.docs.length} disponibilità in eccesso per la data ${mod.turnoVecchio.data}`);
                        }
                    } catch (errDisp) {
                        console.error("Errore durante lo svuotamento delle disponibilità:", errDisp);
                    }

                    const newEq = mod.payloadModifica.nuovoEquipaggio || {};
                    const notifBatch = writeBatch(db);
                    ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(ruoloKey => {
                        const slots = newEq[ruoloKey] || [];
                        const slotArr = Array.isArray(slots) ? slots : Object.values(slots);
                        slotArr.forEach(vol => {
                            if (vol && vol.matricola) {
                                const msgRef = doc(collection(db, "comunicazioni_turni"));
                                const nomeRuolo = ruoloKey.replace(/_/g, ' ').toUpperCase();
                                
                                let dataTurnoFmt = mod.turnoVecchio.data;
                                try {
                                    const parts = mod.turnoVecchio.data.split('-');
                                    if (parts.length === 3) {
                                        dataTurnoFmt = `${parts[2]}/${parts[1]}/${parts[0]}`;
                                    }
                                } catch (e) {}

                                const msgPayload = {
                                    mittente_matricola: String(currentAdminUser.matricola).trim(),
                                    destinatario_matricola: String(vol.matricola).trim(),
                                    testo: `Il tuo turno del ${dataTurnoFmt} (${vol.inizio}-${vol.fine}) come ${nomeRuolo} è stato CONVALIDATO dall'amministratore.`,
                                    tipo: "convalida_turno",
                                    timestamp: new Date().toISOString(),
                                    letto: false,
                                    turno_id: String(mod.idTurno).trim(),
                                    notifica: {
                                        richiede_push: true,
                                        urgente: false,
                                        suono: "default",
                                        titolo: "Turno Convalidato"
                                    }
                                };
                                notifBatch.set(msgRef, msgPayload);
                            }
                        });
                    });
                    await notifBatch.commit();
                }

                successCount++;
                logNotifiche.push({
                    turno_id: mod.idTurno,
                    azione_admin: mod.azione,
                    data_turno: mod.turnoVecchio.data,
                    payload_push: `Turno del ${mod.turnoVecchio.data}: Variazione applicata da ${currentAdminUser.nome}.`
                });
            } catch (err) {
                failCount++;
                console.error(`[TRANSAZIONE] Errore per turno ${mod.idTurno}:`, err);
            }
        }

        console.log("=========================================");
        console.log("🔔 PAYLOAD NOTIFICHE PUSH / EMAIL GENERATO");
        console.log("=========================================");
        console.log(JSON.stringify(logNotifiche, null, 2));

        if (failCount === 0) {
            alert(`Operazione Completata.\n${successCount} modifiche salvate in database. Notifiche iniettate.`);
        } else {
            alert(`Attenzione: ${successCount} modifiche salvate, ${failCount} fallite (possibile conflitto concorrente). Le modifiche fallite non sono state applicate.`);
        }
        
        modificheSospese = [];
        updateStagingUI();
      };

      document.getElementById('btn-save').addEventListener('click', confermaEInviaNotifiche);
      
      // LOGICA SPOSTAMENTO STATE-DRIVEN
      const gestisciClickSpostamento = async (idTurno, ruolo, matricola) => {
          const turnoObj = turniOriginali.get(idTurno);
          if (!turnoObj) return;
          const vol = turnoObj.equipaggio_attuale?.[ruolo]?.find(a => String(a.matricola) === String(matricola));
          if (!vol) return;

          try {
              const docRef = doc(db, "spostamenti_attivi", String(currentAdminUser.matricola).trim());
              await setDoc(docRef, {
                  sourceTurnoId: String(idTurno).trim(),
                  sourceTurnoDataStr: String(turnoObj.data + ' (' + (turnoObj.orario?.inizio || '') + ')').trim(),
                  sourceRoleKey: String(ruolo).trim(),
                  volunteer: {
                      matricola: String(vol.matricola).trim(),
                      nominativo: String(vol.nominativo).trim(),
                      inizio: String(vol.inizio).trim(),
                      fine: String(vol.fine).trim()
                  },
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
                  const volMatricolaStr = String(spostamentoAttivoGlobale.volunteer.matricola).trim();
                  const giaIscrittoInAltroRuolo = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => {
                      if (r === ruoloDest) return false;
                      const slot = newDestEq[r];
                      if (!slot) return false;
                      const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
                      return slotArr.some(m => m && m.matricola && String(m.matricola) === volMatricolaStr);
                  });
                  if (giaIscrittoInAltroRuolo) throw "SLOT_DOPPIO_RUOLO";

                  const destRuolo = newDestEq[ruoloDest] || [];
                  newDestEq[ruoloDest] = [...destRuolo, {
                      ...spostamentoAttivoGlobale.volunteer,
                      convalidato_da_admin: true
                  }];
                  
                  const sourceLogEntry = {
                      timestamp: new Date().toISOString(),
                      autore: String(currentAdminUser.matricola).trim(),
                      azione: String(`Spostamento in uscita verso turno ${destData.data} (${destData.orario?.inizio || ''}) - slot ${ruoloDest}`).trim(),
                      notifica_inviata: false
                  };
                  
                  let destLogEntry = null;
                  if (spostamentoAttivoGlobale.sourceTurnoId !== idTurnoDest) {
                      destLogEntry = {
                          timestamp: new Date().toISOString(),
                          autore: String(currentAdminUser.matricola).trim(),
                          azione: String(`Spostamento in ingresso dal turno ${sourceData.data} (${sourceData.orario?.inizio || ''}) - slot ${spostamentoAttivoGlobale.sourceRoleKey}`).trim(),
                          notifica_inviata: false
                      };
                  }

                  if (spostamentoAttivoGlobale.sourceTurnoId === idTurnoDest) {
                      transaction.update(sourceRef, { equipaggio_attuale: newDestEq, log_modifiche: arrayUnion(sourceLogEntry) });
                  } else {
                      transaction.update(sourceRef, { equipaggio_attuale: newSourceEq, log_modifiche: arrayUnion(sourceLogEntry) });
                      transaction.update(destRef, { equipaggio_attuale: newDestEq, log_modifiche: arrayUnion(destLogEntry) });
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
              } else if (e === "SLOT_DOPPIO_RUOLO") {
                  alert("Errore: Il volontario è già assegnato a un altro ruolo in questo turno di destinazione.");
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
                  await deleteDoc(doc(db, "spostamenti_attivi", String(currentAdminUser.matricola).trim()));
              } catch(e) {
                  console.error("Errore durante l'eliminazione dello spostamento:", e);
                  alert("Errore di rete: impossibile annullare lo spostamento. Riprova.");
              }
          });
      };

      const rimuoviBannerAnnulla = () => {
          const banner = document.getElementById('dynamic-move-banner');
          if (banner) banner.remove();
      };
  }

  // --- LOGICA MODALE INSERIMENTO ---
  let modalTurnoId = null;
  let modalTurnoDate = null;
  let allVolunteersCache = null;

  const modalOverlay = document.getElementById('modal-inserimento');
  const modalTitle = document.getElementById('modal-title');
  const modalRoleSelect = document.getElementById('modal-role-select');
  const modalSearch = document.getElementById('modal-search');
  const modalVolunteersList = document.getElementById('modal-volunteers-list');
  const modalLoading = document.getElementById('modal-loading');

  window.openInsertModal = function(turnoIdStr) {
    const turnoObj = typeof turnoIdStr === 'string' ? window.turniOriginali.get(turnoIdStr) : turnoIdStr;
    if(!turnoObj || !modalOverlay) return;
    modalTurnoId = turnoObj.id;
    modalTurnoDate = turnoObj.data;
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
      // Ricarica la cache se è stata invalidata o è più vecchia di 5 minuti
      const now = Date.now();
      if (!allVolunteersCache || !allVolunteersCache._ts || (now - allVolunteersCache._ts > 5 * 60 * 1000)) {
        const snap = await getDocs(collection(db, "utenti"));
        allVolunteersCache = snap.docs.map(d => d.data());
        allVolunteersCache._ts = now;
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

  function formattaNomeRuoloCodice(ruolo) {
      if (ruolo === 'autista') return 'Autista';
      if (ruolo === 'referente_soreu') return 'Referente SOREU';
      if (ruolo === 'soccorritore') return 'Operatore DAE';
      if (ruolo === 'allievo_quarto_posto') return 'Allievo';
      return ruolo;
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

      // 4. Escludi se già iscritto a un altro ruolo nello stesso turno
      const turnoObj = turniOriginali.get(modalTurnoId);
      if (turnoObj) {
          const giaNelTurno = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => {
              if (r === targetField) return false;
              const slot = turnoObj.equipaggio_attuale?.[r];
              if (!slot) return false;
              const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
              return slotArr.some(a => a && a.matricola && String(a.matricola) === String(v.matricola));
          });
          if (giaNelTurno) return false;
      }

      return true;
    });

    // Trova le matricole disponibili per questa data e QUALSIASI ruolo, registrando se è il ruolo cercato o un altro
    const matricoleDisponibili = new Map(); // matricola -> { id, ruolo, orario, isTargetRole }
    const tObj = turniOriginali.get(modalTurnoId);
    const inizioTurno = tObj?.orario?.inizio || "00:00";
    const fineTurno = tObj?.orario?.fine || "00:00";

    disponibilitaList.forEach(d => {
        if (d.data === modalTurnoDate && d.stato !== 'NON_SELEZIONATO') {
            if (!d.orario || !d.orario.inizio || !d.orario.fine) return;

            const isTargetRole = (d.ruolo === targetField);

            let overlaps = false;
            if (isTargetRole) {
                // Per il ruolo target, calcola l'overlap considerando i buchi esistenti
                const assegnazioni = tObj?.equipaggio_attuale?.[targetField];
                let assArray = [];
                if (assegnazioni) {
                    assArray = Array.isArray(assegnazioni) ? assegnazioni : Object.values(assegnazioni);
                }
                if (assArray.length > 0) {
                    const buchi = calcolaBuchiRuolo(assArray, inizioTurno, fineTurno);
                    if (buchi.length > 0) {
                        overlaps = buchi.some(b => checkTimeOverlap(b.inizio, b.fine, d.orario.inizio, d.orario.fine));
                    }
                } else {
                    overlaps = checkTimeOverlap(inizioTurno, fineTurno, d.orario.inizio, d.orario.fine);
                }
            } else {
                // Per un ruolo diverso da quello target: basta che copra almeno parte dell'orario del turno
                overlaps = tObj
                    ? checkTimeOverlap(inizioTurno, fineTurno, d.orario.inizio, d.orario.fine)
                    : true;
            }

            if (overlaps) {
                const key = String(d.matricola).trim();
                // Se c'è già una disponibilità registrata per questa matricola, diamo la priorità a quella del ruolo corretto
                if (matricoleDisponibili.has(key)) {
                    const existing = matricoleDisponibili.get(key);
                    if (!existing.isTargetRole && isTargetRole) {
                        matricoleDisponibili.set(key, { id: d.id, ruolo: d.ruolo, orario: d.orario, isTargetRole: true });
                    }
                } else {
                    matricoleDisponibili.set(key, { id: d.id, ruolo: d.ruolo, orario: d.orario, isTargetRole: isTargetRole });
                }
            }
        }
    });

    // Ordinamento: prima chi è disponibile per il ruolo cercato (score 2), poi per altri ruoli (score 1), poi non disponibile (score 0)
    filtered.sort((a, b) => {
      const uMatA = String(a.matricola).trim();
      const uMatB = String(b.matricola).trim();
      
      const dispA = matricoleDisponibili.get(uMatA);
      const dispB = matricoleDisponibili.get(uMatB);
      
      const scoreA = dispA ? (dispA.isTargetRole ? 2 : 1) : 0;
      const scoreB = dispB ? (dispB.isTargetRole ? 2 : 1) : 0;
      
      if (scoreA !== scoreB) {
          return scoreB - scoreA;
      }
      
      const nameA = `${a.cognome || ''} ${a.nome || ''}`.trim().toLowerCase();
      const nameB = `${b.cognome || ''} ${b.nome || ''}`.trim().toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    modalVolunteersList.innerHTML = '';
    
    filtered.forEach(u => {
      const uMatricola = String(u.matricola).trim();
      const dispInfo = matricoleDisponibili.get(uMatricola);
      const isDisponibile = !!dispInfo;
      
      const div = document.createElement('div');
      div.className = 'volunteer-item';
      
      if (isDisponibile) {
          if (dispInfo.isTargetRole) {
              div.style.borderLeft = '4px solid #00ffcc';
              div.style.background = 'rgba(0, 255, 204, 0.05)';
          } else {
              div.style.borderLeft = '4px solid var(--neon-orange)';
              div.style.background = 'rgba(255, 153, 0, 0.05)';
          }
      }
      
      let badgeDisp = '';
      if (isDisponibile) {
          if (dispInfo.isTargetRole) {
              badgeDisp = `<span class="badge" style="background:rgba(0,255,204,0.2); color:#00ffcc; font-size:0.7rem; font-weight:bold; margin-left:0.5rem; padding: 2px 6px;">DISPONIBILE (${dispInfo.orario.inizio}-${dispInfo.orario.fine})</span>`;
          } else {
              const ruoloLabelFmt = formattaNomeRuoloCodice(dispInfo.ruolo);
              badgeDisp = `<span class="badge" style="background:rgba(255,153,0,0.2); color:var(--neon-orange); font-size:0.7rem; font-weight:bold; margin-left:0.5rem; padding: 2px 6px;">DISP. COME ${ruoloLabelFmt.toUpperCase()} (${dispInfo.orario.inizio}-${dispInfo.orario.fine})</span>`;
          }
      }
          
      // Serializziamo dispInfo come data-attribute JSON per passarlo al click handler in modo sicuro
      const dispInfoAttr = dispInfo ? encodeURIComponent(JSON.stringify(dispInfo)) : '';
      div.innerHTML = `
        <div>
          <strong>${u.nome || ''} ${u.cognome || ''}</strong> ${badgeDisp}<br>
          <small>Matricola: ${u.matricola || 'N/A'}</small>
        </div>
        <button class="btn" data-matricola="${String(u.matricola).trim()}" data-dispinfo="${dispInfoAttr}">Seleziona</button>
      `;
      div.querySelector('button').addEventListener('click', (e) => {
          e.stopPropagation();
          selectVolunteerForSlot(u, dispInfo || null);
      });
      modalVolunteersList.appendChild(div);
    });
  }

  async function selectVolunteerForSlot(user, dispInfo) {
    const selectedOption = modalRoleSelect.options[modalRoleSelect.selectedIndex];
    const field = selectedOption.getAttribute('data-field');
    const startGap = selectedOption.getAttribute('data-inizio');
    const endGap = selectedOption.getAttribute('data-fine');
    const isOccupied = selectedOption.text.includes('(Occupato');
    
    if (isOccupied) {
      if (!confirm("Questo ruolo è già completamente coperto. Vuoi comunque aggiungere questo volontario?")) return;
    }

    if (dispInfo && !dispInfo.isTargetRole) {
      const ruoloVecchio = formattaNomeRuoloCodice(dispInfo.ruolo);
      const ruoloNuovo = formattaNomeRuoloCodice(field);
      const confirmMsg = `Il volontario ${user.nome || ''} ${user.cognome || ''} si è reso disponibile come ${ruoloVecchio}. Vuoi cambiare la sua disponibilità in ${ruoloNuovo} e assegnarlo a questo turno?`;
      if (!confirm(confirmMsg)) return;
      
      try {
        modalLoading.style.display = 'block';
        const dispRef = doc(db, "disponibilita", dispInfo.id);
        await updateDoc(dispRef, { ruolo: field });
        console.log(`[DEBUG_DB] Aggiornato ruolo disponibilità per ${user.matricola} da ${dispInfo.ruolo} a ${field}`);
      } catch (err) {
        console.error("Errore durante l'aggiornamento del ruolo disponibilità:", err);
        alert("Errore durante l'aggiornamento del ruolo della disponibilità: " + err);
        modalLoading.style.display = 'none';
        return;
      }
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
          
          const userMatricolaStr = String(user.matricola).trim();
          const giaIscrittoInAltroRuolo = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => {
              if (r === field) return false;
              const slot = currentEq[r];
              if (!slot) return false;
              const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
              return slotArr.some(m => m && m.matricola && String(m.matricola) === userMatricolaStr);
          });
          if (giaIscrittoInAltroRuolo) {
              throw "Il volontario è già assegnato a un altro ruolo in questo turno.";
          }

          // Se stavamo inserendo in uno slot originariamente libero, ma ora è occupato, blocchiamo
          // Nota: potremmo usare calcolaCoperturaRuolo per essere più precisi, ma in caso di array accodiamo
          const fieldArray = Array.isArray(currentEq[field]) ? currentEq[field] : Object.values(currentEq[field] || {});
          
          const newEq = { ...currentEq };
          newEq[field] = [
              ...fieldArray,
              {
                  matricola: String(user.matricola).trim(),
                  nominativo: String(user.nominativo || formattaNominativoUtente(user)).trim(),
                  inizio: String(startGap).trim(),
                  fine: String(endGap).trim(),
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
          alert("Errore durante l'aggiornamento del turno: " + e);
      }
    }
  }
});

// MESSAGING SERVICE UI BINDING
document.addEventListener("DOMContentLoaded", () => {
    const badgeContainer = document.getElementById("messaging-badge-container");
    const msgPanel = document.getElementById("messaging-panel");
    const closePanelBtn = document.getElementById("close-messaging-panel");
    const unreadCountSpan = document.getElementById("msg-unread-count");
    const listContainer = document.getElementById("messaging-list-container");

    // Toggle Panel Visibility
    if (badgeContainer && msgPanel) {
        badgeContainer.addEventListener("click", () => {
            msgPanel.style.display = msgPanel.style.display === "none" ? "block" : "none";
        });
    }
    if (closePanelBtn && msgPanel) {
        closePanelBtn.addEventListener("click", () => { msgPanel.style.display = "none"; });
    }

    // Determine current user matricola from session/global state (Fallback to '34' for admin dashboard context)
    const currentMatricola = window.currentLoggedUserMatricola || "34";

    // Start the Real-Time Engine Listener
    if (window.AppMessaging && window.AppMessaging.listenForMessages) {
        window.AppMessaging.listenForMessages(currentMatricola, (messaggi) => {
            const unreadCount = messaggi.filter(m => !m.letto).length;
            
            // Update Badge Count
            if (unreadCount > 0) {
                unreadCountSpan.textContent = unreadCount;
                unreadCountSpan.style.display = "block";
            } else {
                unreadCountSpan.style.display = "none";
            }

            // Render Messages List
            if (messaggi.length === 0) {
                listContainer.innerHTML = `<p style="color: #888; text-align: center; margin-top: 50px;">Nessun messaggio presente.</p>`;
                return;
            }

            listContainer.innerHTML = messaggi.map(msg => {
                const borderNeon = msg.letto ? 'rgba(255,255,255,0.05)' : '1px solid #ff0055';
                const bgState = msg.letto ? 'rgba(255,255,255,0.02)' : 'rgba(255, 0, 85, 0.05)';
                const testoSicuro = escapeHtml(msg.testo || '');
                
                return `
                    <div class="msg-card" data-id="${msg.id}" style="background: ${bgState}; border: 1px solid ${borderNeon}; border-radius: 6px; padding: 12px; margin-bottom: 10px; transition: all 0.2s;">
                        <div style="font-size: 11px; color: #888; margin-bottom: 5px; display: flex; justify-content: space-between;">
                            <span>Da: Matr. ${escapeHtml(msg.mittente_matricola || '')}</span>
                            <span>${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                        <div style="font-size: 13px; color: #e0e0e0; line-height: 1.4; word-break: break-word;">${testoSicuro}</div>
                        ${!msg.letto ? `<button class="mark-read-btn" data-id="${msg.id}" style="margin-top: 8px; background: transparent; border: 1px solid #00ffcc; color: #00ffcc; border-radius: 4px; font-size: 10px; padding: 2px 6px; cursor: pointer;">Segna come letto</button>` : ''}
                    </div>
                `;
            }).join('');

            // Bind Mark As Read Buttons
            listContainer.querySelectorAll(".mark-read-btn").forEach(btn => {
                btn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    const msgId = btn.getAttribute("data-id");
                    if (window.AppMessaging.markAsRead) {
                        await window.AppMessaging.markAsRead(msgId);
                    }
                });
            });
        });
    }
    const typeSelect = document.getElementById("msg-type-select");
    const searchInput = document.getElementById("msg-search-input");
    const resultsContainer = document.getElementById("msg-search-results");
    const sendBtn = document.getElementById("send-msg-btn");
    const textInput = document.getElementById("msg-text-input");
    const templateSelect = document.getElementById("msg-template-select");
    const soundToggle = document.getElementById("msg-urgent-sound-toggle");

    let selectedMatricola = null;

    if (typeSelect && searchInput) {
        typeSelect.addEventListener("change", () => {
            const isSingle = typeSelect.value === "SINGLE";
            searchInput.style.display = isSingle ? "block" : "none";
            if (!isSingle) {
                if (resultsContainer) resultsContainer.style.display = "none";
                selectedMatricola = null;
                searchInput.value = "";
            }
        });
    }

    // Live Filtering on Keydown/Input
    if (searchInput && resultsContainer) {
        searchInput.addEventListener("input", () => {
            const query = searchInput.value.trim().toLowerCase();
            if (!query) {
                resultsContainer.style.display = "none";
                return;
            }

            // Access available global volunteer data arrays
            const arrayVolontari = window.listaUtenti || window.volontari || window.globalVolontari || Object.values(window.globalUsersMap || {});
            
            // Filter elements matching name or surname
            const filtered = arrayVolontari.filter(v => 
                String(v.cognome || '').toLowerCase().includes(query) || 
                String(v.nome || '').toLowerCase().includes(query)
            );

            if (filtered.length === 0) {
                resultsContainer.innerHTML = '<div style="padding: 8px; color: #888; font-size: 12px;">Nessun volontario trovato</div>';
                resultsContainer.style.display = "block";
                return;
            }

            // Render matching rows
            resultsContainer.innerHTML = filtered.map(v => `
                <div class="suggest-item" data-id="${String(v.matricola).trim()}" data-fullname="${v.cognome || ''} ${v.nome || ''}" style="padding: 8px; cursor: pointer; font-size: 12px; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
                    ${v.cognome || ''} ${v.nome || ''} <span style="color: #00ffcc; font-size: 10px; float: right;">Matr. ${v.matricola}</span>
                </div>
            `).join('');

            resultsContainer.style.display = "block";

            // Bind click event to rows
            resultsContainer.querySelectorAll(".suggest-item").forEach(item => {
                item.addEventListener("click", () => {
                    selectedMatricola = item.getAttribute("data-id");
                    searchInput.value = item.getAttribute("data-fullname");
                    resultsContainer.style.display = "none";
                    console.log(`[MESSAGING_UI] Selezionato utente: ${searchInput.value} (Matr. ${selectedMatricola})`);
                });
            });
        });

        // Close list if user clicks outside
        document.addEventListener("click", (e) => {
            if (e.target !== searchInput && e.target !== resultsContainer) {
                resultsContainer.style.display = "none";
            }
        });
    }

    // Updated Submission Execution
    if (sendBtn) {
        sendBtn.addEventListener("click", async () => {
            let testoCorpo = textInput.value.trim();
            const templateSelezionato = templateSelect ? templateSelect.value : "CUSTOM";
            const riproduciSuono = soundToggle ? soundToggle.checked : true;
            
            if (templateSelezionato !== "CUSTOM") {
                const opzioneSelezionata = templateSelect.options[templateSelect.selectedIndex].text;
                testoCorpo = opzioneSelezionata + "\n\n" + testoCorpo;
            }

            if (!testoCorpo && templateSelezionato === "CUSTOM") { 
                alert("Il testo del messaggio è vuoto."); 
                return; 
            }

            let destinatario = "ALL";
            
            if (typeSelect.value === "SINGLE") {
                if (!selectedMatricola) {
                    alert("Seleziona un volontario valido cliccando tra i suggerimenti che appaiono mentre digiti.");
                    return;
                }
                destinatario = selectedMatricola;
            }

            const mittente = window.currentLoggedUserMatricola || "34";

            sendBtn.disabled = true;
            sendBtn.textContent = "Invio in corso...";

            if (window.AppMessaging && window.AppMessaging.sendMessage) {
                const response = await window.AppMessaging.sendMessage(
                    mittente, 
                    destinatario, 
                    testoCorpo, 
                    templateSelezionato === "EMERGENZA" ? "critico" : "comunicazione_generica",
                    {
                        richiede_notifica_push: true,
                        urgente: true,
                        suono: riproduciSuono ? "alarm.mp3" : "default",
                        titolo_notifica: templateSelezionato !== "CUSTOM" ? "Avviso Urgente Associazione" : "Nuovo Messaggio di Servizio"
                    }
                );

                sendBtn.disabled = false;
                sendBtn.textContent = "Invia Messaggio";

                if (response.success) {
                    textInput.value = "";
                    if (searchInput) searchInput.value = "";
                    selectedMatricola = null;
                    alert("Messaggio e Notifica Push inoltrati con successo!");
                } else {
                    alert("Errore nell'invio: " + (response.error || "Sconosciuto"));
                }
            } else {
                sendBtn.disabled = false;
                sendBtn.textContent = "Invia Messaggio";
                alert("Errore critico: Servizio di messaggistica non trovato.");
            }
        });
    }
});


