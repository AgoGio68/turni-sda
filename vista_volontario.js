/*
================================================================================================
CONFIGURAZIONI DA ATTIVARE MANUALMENTE SULLA CONSOLE FIREBASE (BLOCCANTI PER IL LOGIN)
================================================================================================
1. Authentication: Abilitare il provider "Email/Password".
2. Firestore Database: Creare una collezione "utenti" e "turni".
3. Firestore Rules:
   - match /utenti/{matricola} { allow read: if request.auth != null; }
   - match /turni/{turno} { allow read, write: if request.auth != null; }
================================================================================================
*/
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, collection, query, onSnapshot, doc, updateDoc, getDoc, runTransaction } from "firebase/firestore";
import { verificaIscrizione, validaRiposi } from './regole_iscrizione.js';
import { formattaNominativoUtente, formattaNomeDisplay, sanificaTurno, calcolaCoperturaRuolo } from './utils.js';

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

let currentUser = null;
let activeUnsubscribeTurni = null;

// Rileva modalità Kiosk dal parametro URL
const isKioskMode = new URLSearchParams(window.location.search).get('mode') === 'kiosk';

document.addEventListener('DOMContentLoaded', () => {
  const userInfoDiv = document.getElementById('user-info');
  
  // In modalità kiosk, NON redirigere alla vista responsabile
  if (!isKioskMode) {
      const isSuperAdminOverride = localStorage.getItem('superadmin_override') === 'true';
      if (isSuperAdminOverride) {
          window.location.href = "vista_responsabile.html";
          return;
      }
  }

  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        const matricola = user.email.split('@')[0];
        
        // ---- KIOSK MODE: bypass speciali ----
        if (isKioskMode) {
            currentUser = { matricola: 'kiosk', nome: 'Tabellone', cognome: 'Kiosk', is_kiosk: true };
            userInfoDiv.innerHTML = `<span style="color:var(--neon-orange);">🖥️ Modalità Tabellone (Sola Lettura)</span>`;
            initApp();
            return;
        }
        
        // Se AgoGio finisce qui per sbaglio, rimandalo alla vista_responsabile
        if (matricola.toLowerCase() === 'agogio') {
           localStorage.setItem('superadmin_override', 'true');
           window.location.href = "vista_responsabile.html";
           return;
        }

        const snap = await getDoc(doc(db, "utenti", matricola));
        if (snap.exists()) {
          currentUser = snap.data();
          let adminBtnHTML = "";
          if (currentUser.is_admin) {
              adminBtnHTML = `<button id="btn-goto-admin" class="btn" style="margin-left:1rem; padding: 0.3rem 0.6rem; font-size:0.8rem; border-color:var(--neon-green); color:var(--neon-green); background:rgba(57,255,20,0.1);">Accedi a Programmazione</button>`;
          }

          userInfoDiv.innerHTML = `Profilo: ${formattaNominativoUtente(currentUser)} ${adminBtnHTML} <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
          
          document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
          
          if (currentUser.is_admin) {
              document.getElementById('btn-goto-admin').addEventListener('click', () => {
                  window.location.href = "vista_responsabile.html";
              });
          }
          initApp();
        } else {
          console.error("Errore Logico: Profilo volontario non trovato in Firestore. Matricola:", matricola);
          alert("Profilo volontario non trovato nel database.");
          signOut(auth);
        }
      } else {
        window.location.href = "index.html";
      }
    } catch (e) {
      console.error("Errore in onAuthStateChanged:", e.code, e.message);
    }
  });

  function initApp() {
      const calendar = document.getElementById('calendar');
      const bottomSheet = document.getElementById('bottom-sheet');
      const bsOverlay = document.getElementById('bs-overlay');
      const bsTitle = document.getElementById('bs-title');
      const bsContent = document.getElementById('bs-content');
      const btnCloseDetails = document.getElementById('btn-close-details');

      let turniList = [];
      let currentSelectedDate = null;
      let currentFilter = 'focus'; // 'focus' | 'miei' | 'tabellone'
      let isTvMode = isKioskMode; // Se kiosk, parte in TV mode

      // =====================================================
      //  SIDEBAR: FILTRI A 3 STATI
      // =====================================================
      const filterButtons = document.querySelectorAll('.filter-btn');
      filterButtons.forEach(btn => {
          btn.addEventListener('click', () => {
              filterButtons.forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              currentFilter = btn.getAttribute('data-filter');
              renderMacroCalendar();
          });
      });

      // =====================================================
      //  KIOSK: Attivazione automatica TV + Tabellone
      // =====================================================
      if (isKioskMode) {
          currentFilter = 'tabellone';
          document.body.classList.add('tv-mode');
          const sidebar = document.getElementById('sidebar');
          if (sidebar) sidebar.style.display = 'none';
          filterButtons.forEach(b => b.classList.remove('active'));
          const tabBtn = document.getElementById('filter-tabellone');
          if (tabBtn) tabBtn.classList.add('active');
          
          // Fullscreen nativo
          if (document.documentElement.requestFullscreen) {
              document.documentElement.requestFullscreen().catch(() => {});
          }
      }

      // =====================================================
      //  MODALITÀ TV (FULLSCREEN)
      // =====================================================
      const btnTv = document.getElementById('btn-tv-mode');
      btnTv.addEventListener('click', () => {
          isTvMode = !isTvMode;
          document.body.classList.toggle('tv-mode', isTvMode);
          btnTv.textContent = isTvMode ? '↩️ Esci da Modalità TV' : '🖥️ Modalità TV (Fullscreen)';
          
          if (isTvMode) {
              // Forza il Tabellone quando si entra in TV
              currentFilter = 'tabellone';
              filterButtons.forEach(b => b.classList.remove('active'));
              document.getElementById('filter-tabellone').classList.add('active');
              
              // Prova il fullscreen nativo
              if (document.documentElement.requestFullscreen) {
                  document.documentElement.requestFullscreen().catch(() => {});
              }
          } else {
              if (document.fullscreenElement) {
                  document.exitFullscreen().catch(() => {});
              }
              currentFilter = 'focus';
              filterButtons.forEach(b => b.classList.remove('active'));
              document.getElementById('filter-focus').classList.add('active');
          }
          renderMacroCalendar();
      });

      // =====================================================
      //  FIRESTORE: LISTENER REAL-TIME
      // =====================================================
      if (activeUnsubscribeTurni) {
          activeUnsubscribeTurni();
      }

      const q = query(collection(db, "turni")); 
      
      activeUnsubscribeTurni = onSnapshot(q, (snapshot) => {
        turniList = snapshot.docs.map(doc => sanificaTurno({ id: doc.id, ...doc.data() }));
        renderMacroCalendar();
        
        if (bottomSheet.classList.contains('active') && currentSelectedDate) {
          renderMicroDay(currentSelectedDate);
        }
      });

      const closeBottomSheet = () => {
        bottomSheet.classList.remove('active');
        bsOverlay.classList.remove('active');
        if (btnCloseDetails) btnCloseDetails.classList.remove('active');
        currentSelectedDate = null;
      };
      bsOverlay.addEventListener('click', closeBottomSheet);
      if (btnCloseDetails) btnCloseDetails.addEventListener('click', closeBottomSheet);

      // =====================================================
      //  UTILITY: Verifica se l'utente è in un turno
      // =====================================================
      const getUserRoleInShift = (turno) => {
          const eq = turno.equipaggio_attuale || {};
          const myId = String(currentUser.matricola);
          if (eq.autista && eq.autista.some(a => String(a.matricola) === myId)) return 'Autista';
          if (eq.referente_soreu && eq.referente_soreu.some(a => String(a.matricola) === myId)) return 'Rif. SOREU';
          if (eq.soccorritore && eq.soccorritore.some(a => String(a.matricola) === myId)) return 'Soccorritore';
          if (eq.allievo_quarto_posto && eq.allievo_quarto_posto.some(a => String(a.matricola) === myId)) return 'Allievo';
          return null;
      };

      // =====================================================
      //  UTILITY: Rendering equipaggio inline ordinato
      // =====================================================
      const renderInlineEquipaggio = (turno) => {
          const eq = turno.equipaggio_attuale || {};
          const req = turno.requisiti_equipaggio || {};
          
          const slots = [];
          
          const addSlot = (key, label, assegnazioni, richiesto) => {
              if (!richiesto && key !== 'allievo_quarto_posto') return;
              if (key === 'allievo_quarto_posto' && !richiesto) return;
              
              if (assegnazioni && assegnazioni.length > 0) {
                  assegnazioni.forEach(membro => {
                      const isMe = String(membro.matricola) === String(currentUser.matricola);
                      const nomeDb = membro.nominativo || 'Sconosciuto';
                      const nomeDisplay = nomeDb !== 'Sconosciuto' ? formattaNomeDisplay(nomeDb) : nomeDb;
                      const textColor = membro.convalidato_da_admin ? '#32CD32' : '#FFD700';
                      slots.push({
                          label,
                          nome: `<span style="color:${textColor}; font-weight:bold;">${nomeDisplay}</span> (${membro.inizio}-${membro.fine})`,
                          isMe,
                          isEmpty: false,
                          sortKey: nomeDb
                      });
                  });
              } else {
                  slots.push({
                      label,
                      nome: 'DA COPRIRE',
                      isMe: false,
                      isEmpty: true,
                      sortKey: 'ZZZZZ'
                  });
              }
          };
          
          addSlot('autista', 'AUT', eq.autista, req.autista_richiesto);
          addSlot('referente_soreu', 'RIF', eq.referente_soreu, req.referente_richiesto);
          addSlot('soccorritore', 'DAE', eq.soccorritore, req.soccorritore_richiesto);
          addSlot('allievo_quarto_posto', 'ALL', eq.allievo_quarto_posto, req.allievo_consentito);
          
          return slots.map(s => {
              const nameClass = s.isEmpty ? 'crew-vuoto' : (s.isMe ? 'crew-me' : '');
              return `<li><span class="crew-role">${s.label}</span> <span class="${nameClass}">${s.isEmpty ? '⚠ DA COPRIRE' : s.nome}</span></li>`;
          }).join('');
      };

      // =====================================================
      //  RENDERING: MACRO CALENDARIO
      // =====================================================
      const renderMacroCalendar = () => {
        calendar.innerHTML = '';
        
        // Filtraggio in base allo stato del sidebar
        let turniDaRendere = turniList;
        if (currentFilter === 'miei') {
            turniDaRendere = turniList.filter(t => getUserRoleInShift(t) !== null);
        }
        
        const turniPerData = turniDaRendere.reduce((acc, turno) => {
            if(!acc[turno.data]) acc[turno.data] = [];
            acc[turno.data].push(turno);
            return acc;
        }, {});

        const dateOrdinate = Object.keys(turniPerData).sort();

        if (dateOrdinate.length === 0 && currentFilter === 'miei') {
            calendar.innerHTML = '<p style="color:var(--text-muted); grid-column: 1 / -1; text-align:center; padding: 2rem;">Non sei iscritto a nessun turno al momento.</p>';
            return;
        }

        dateOrdinate.forEach(dataString => {
          const turniDelGiorno = turniPerData[dataString];
          const card = document.createElement('div');
          card.className = 'day-card';
          card.style.minHeight = '140px';
          
          // -----------------------------------------------
          //  HIGHLIGHT: Calcola il ruolo per OGNI singolo turno e aggiungi la classe .my-shift
          // -----------------------------------------------
          let myRolesPerFascia = { M: null, P: null, N: null };
          let isMyDay = false;
          turniDelGiorno.forEach(t => {
              const role = getUserRoleInShift(t);
              if (role) {
                  isMyDay = true;
                  const oraI = parseInt((t.orario?.inizio || '08:00').split(':')[0]);
                  const f = oraI < 13 ? 'M' : (oraI < 19 ? 'P' : 'N');
                  myRolesPerFascia[f] = role;
              }
          });
          
          if (isMyDay) {
              card.classList.add('my-shift');
          }
          
          let badgeClass = 'incompleto';
          let statoDay = 'Aperto';
          
          let allFull = true;
          let anyCritical = false;
          let fasce = { M: null, P: null, N: null };

          turniDelGiorno.forEach(t => {
              const eq = t.equipaggio_attuale || {};
              const req = t.requisiti_equipaggio || {};
              
              const inizioTurno = t.orario?.inizio || "00:00";
              const fineTurno = t.orario?.fine || "00:00";
              const aut = !req.autista_richiesto || calcolaCoperturaRuolo(eq.autista, inizioTurno, fineTurno).isFull;
              const ref = !req.referente_richiesto || calcolaCoperturaRuolo(eq.referente_soreu, inizioTurno, fineTurno).isFull;
              const soc = !req.soccorritore_richiesto || calcolaCoperturaRuolo(eq.soccorritore, inizioTurno, fineTurno).isFull;

              const isCritico = !aut || !ref || !soc;
              const isFull = aut && ref && soc;

              if (isCritico) anyCritical = true;
              if (!isFull) allFull = false;

              const oraInizio = parseInt((t.orario?.inizio || "08:00").split(':')[0]);
              let fascia = oraInizio < 13 ? 'M' : (oraInizio < 19 ? 'P' : 'N');
              let color = isCritico ? 'rosso' : (isFull ? 'verde' : 'giallo');
              
              if(fasce[fascia] === 'rosso') color = 'rosso'; 
              else if(fasce[fascia] === 'giallo' && color === 'verde') color = 'giallo';
              
              fasce[fascia] = color;
          });

          if(anyCritical) { badgeClass = 'critico'; statoDay = 'Incompleto'; }
          else if(allFull) { badgeClass = 'pieno'; statoDay = 'Completo'; }

          const dateParts = dataString.split('-');
          const formattedDate = `${dateParts[2]}/${dateParts[1]}`;

          // I badge ruolo sono ora gestiti a livello di singolo turno (inline card e micro-bar)

          // -----------------------------------------------
          //  STATO 2 & 3: Equipaggi inline
          // -----------------------------------------------
          let inlineCardsHTML = '';
          if (currentFilter === 'miei' || currentFilter === 'tabellone') {
              const turniOrdGiorno = turniDelGiorno.sort((a,b) => (a.orario?.inizio||'').localeCompare(b.orario?.inizio||''));
              inlineCardsHTML = turniOrdGiorno.map(t => {
                  const myRole = getUserRoleInShift(t);
                  const tipo = (t.tipo_servizio||'').replace(/_/g, ' ');
                  const cardClass = myRole ? 'inline-shift-card my-shift-inline' : 'inline-shift-card';
                  const roleBadge = myRole ? `<span class="my-role-badge">${myRole}</span>` : '';
                  
                  return `
                      <div class="${cardClass}">
                          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.3rem;">
                              <span><strong style="font-size:0.7rem; color:var(--text-muted);">${tipo}</strong> ${roleBadge}</span>
                              <span style="font-size:0.7rem; color:var(--text-muted);">🕒 ${t.orario?.inizio}-${t.orario?.fine}</span>
                          </div>
                          <ul class="inline-crew-list">${renderInlineEquipaggio(t)}</ul>
                      </div>
                  `;
              }).join('');
          }
          
          // -----------------------------------------------
          //  RENDERING CARD
          // -----------------------------------------------
          if (currentFilter === 'focus') {
              // STATO 1: Macro card classica con micro-bars
              // Per ogni fascia, aggiungere badge ruolo solo se l'utente è in QUELLA fascia
              const microBarRow = (label, fasciaKey) => {
                  const myRole = myRolesPerFascia[fasciaKey];
                  const badgeHTML = myRole ? ` <span class="my-role-badge">${myRole}</span>` : '';
                  const barClass = myRole ? `micro-bar ${fasce[fasciaKey] || ''} my-micro-bar` : `micro-bar ${fasce[fasciaKey] || ''}`;
                  return `
                      <span class="micro-bar-label">${label}${badgeHTML}</span>
                      <div class="${barClass}"></div>
                  `;
              };

              card.innerHTML = `
                <strong style="font-size: 1.25rem; text-shadow: 0 0 5px rgba(255,255,255,0.2);">${formattedDate}</strong>
                <span class="badge ${badgeClass}" style="margin-top: 0.25rem; font-size: 0.65rem;">${statoDay}</span>
                
                <div class="micro-bars">
                    ${microBarRow('Mattina', 'M')}
                    ${microBarRow('Pomeriggio', 'P')}
                    ${microBarRow('Notte', 'N')}
                </div>
              `;
          } else {
              // STATO 2 e 3: Card con equipaggi inline
              card.style.minHeight = 'auto';
              card.innerHTML = `
                <strong style="font-size: 1.25rem; text-shadow: 0 0 5px rgba(255,255,255,0.2);">${formattedDate}</strong>
                <span class="badge ${badgeClass}" style="margin-top: 0.25rem; font-size: 0.65rem;">${statoDay}</span>
                ${inlineCardsHTML}
              `;
          }

          card.addEventListener('click', () => {
            currentSelectedDate = dataString;
            renderMicroDay(dataString);
            bottomSheet.classList.add('active');
            bsOverlay.classList.add('active');
            if (btnCloseDetails) btnCloseDetails.classList.add('active');
          });

          calendar.appendChild(card);
        });
      };

      // =====================================================
      //  RENDERING: MICRO (BOTTOM SHEET) — invariato
      // =====================================================
      const renderMicroDay = (dataString) => {
        bsTitle.textContent = `Turni del ${dataString.split('-').reverse().join('/')}`;
        bsContent.innerHTML = '';

        const turniDelGiorno = turniList.filter(t => t.data === dataString)
                                         .sort((a,b) => (a.orario?.inizio||'').localeCompare(b.orario?.inizio||''));

        if(turniDelGiorno.length === 0) {
            bsContent.innerHTML = '<p style="color:var(--text-muted)">Nessun turno previsto per questa giornata.</p>';
            return;
        }

        turniDelGiorno.forEach(turno => {
            const card = document.createElement('div');
            card.className = 'shift-card';
            
            const eq = turno.equipaggio_attuale || {};
            const req = turno.requisiti_equipaggio || {};

            let currentStato = turno.stato_turno || 'APERTO';
            const inizioTurno = turno.orario?.inizio || "00:00";
            const fineTurno = turno.orario?.fine || "00:00";
            
            const aut = !req.autista_richiesto || calcolaCoperturaRuolo(eq.autista, inizioTurno, fineTurno).isFull;
            const ref = !req.referente_richiesto || calcolaCoperturaRuolo(eq.referente_soreu, inizioTurno, fineTurno).isFull;
            const soc = !req.soccorritore_richiesto || calcolaCoperturaRuolo(eq.soccorritore, inizioTurno, fineTurno).isFull;
            
            if (!aut || !ref || !soc) {
                currentStato = 'INCOMPLETO';
            } else if (currentStato !== 'CONVALIDATO') {
                currentStato = 'COMPLETO';
            }
            const bgClass = (currentStato === 'COMPLETO' || currentStato === 'CONVALIDATO') ? 'pieno' : 'critico';

            card.innerHTML = `
                <div class="shift-header">
                    <div>
                        <strong style="color:var(--text-main); font-size:1.1rem; letter-spacing: 0.5px;">${(turno.tipo_servizio||'').replace(/_/g, ' ')}</strong><br>
                        <span style="color:var(--text-muted); font-size:0.9rem;">🕒 ${turno.orario?.inizio} - ${turno.orario?.fine}</span>
                    </div>
                    <span class="badge ${bgClass}">${currentStato}</span>
                </div>
                <div class="shift-slots">
                    ${renderSlotRow(turno, 'autista', 'AUTISTA', eq.autista, req.autista_richiesto, '🚑', turniList)}
                    ${renderSlotRow(turno, 'referente_soreu', 'SOCC. REFERENTE SOREU', eq.referente_soreu, req.referente_richiesto, '📞', turniList)}
                    ${renderSlotRow(turno, 'soccorritore', 'OPERATORE DAE', eq.soccorritore, req.soccorritore_richiesto, '🎒', turniList)}
                    ${renderSlotRow(turno, 'allievo_quarto_posto', 'ALLIEVO 4° POSTO', eq.allievo_quarto_posto, req.allievo_consentito, '🔰', turniList)}
                </div>
            `;
            bsContent.appendChild(card);
        });
        
        document.querySelectorAll('.btn-take').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idTurno = e.currentTarget.getAttribute('data-turno');
                const ruolo = e.currentTarget.getAttribute('data-ruolo');
                await iscriviti(idTurno, ruolo);
            });
        });

        document.querySelectorAll('.btn-remove-vol').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idTurno = e.currentTarget.getAttribute('data-turno');
                const ruolo = e.currentTarget.getAttribute('data-ruolo');
                await rimuoviVolontario(idTurno, ruolo);
            });
        });

        document.querySelectorAll('.btn-edit-time').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idTurno = e.currentTarget.getAttribute('data-turno');
                const ruolo = e.currentTarget.getAttribute('data-ruolo');
                const orarioFine = e.currentTarget.getAttribute('data-fine');
                await modificaOrarioFine(idTurno, ruolo, orarioFine);
            });
        });
      };

      // =====================================================
      //  RENDERING: SLOT ROW
      // =====================================================
      const renderSlotRow = (turno, keyRuolo, labelRuolo, assegnazioni, richiesto, icon, fullTurniList) => {
        if(!richiesto && keyRuolo !== 'allievo_quarto_posto') return ''; 
        if(keyRuolo === 'allievo_quarto_posto' && !richiesto) return ''; 

        let html = '';
        const myIdStr = String(currentUser.matricola);
        
        let iAmInThisRole = false;

        if (assegnazioni && assegnazioni.length > 0) {
            assegnazioni.forEach(membro => {
                const isMe = String(membro.matricola) === String(currentUser.matricola);
                if (isMe) iAmInThisRole = true;
                
                const nomeDb = membro.nominativo || 'Sconosciuto';
                const nomeDisplay = nomeDb !== 'Sconosciuto' ? formattaNomeDisplay(nomeDb) : nomeDb;
                const textColor = membro.convalidato_da_admin ? '#32CD32' : '#FFD700';
                const textContent = isMe ? `Tu (${nomeDisplay}) [${membro.inizio}-${membro.fine}]` : `${nomeDisplay} [${membro.inizio}-${membro.fine}]`;
                
                const isAdmin = currentUser.ruolo === 'admin' || currentUser.ruolo === 'superadmin' || currentUser.is_admin === true;
                const btnRemoveHtml = (isAdmin || isMe) ? `<button class="btn-remove-vol" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-matricola="${membro.matricola}" title="Rimuovi" style="background:transparent; border:none; cursor:pointer; margin-left:0.5rem;">❌</button>` : '';
                const btnEditHtml = isMe ? `<button class="btn-edit-time" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-fine="${membro.fine}" title="Modifica Orario Fine" style="background:transparent; border:none; cursor:pointer; margin-left:0.2rem; font-size:1rem;">✏️</button>` : '';

                const nomeStampato = `<span style="color:${textColor}; font-weight:bold;">${textContent}</span>${btnEditHtml}${btnRemoveHtml}`;
                const statoStr = membro.convalidato_da_admin ? '<span class="status-badge status-conv">[CONVALIDATO]</span>' : '<span class="status-badge status-wait">[IN ATTESA]</span>';
                const rowColorClass = membro.convalidato_da_admin ? 'slot-confermato' : 'slot-prenotato';
                
                html += `
                    <div class="slot-row ${rowColorClass}">
                        <div class="slot-info">
                            <span class="slot-icon">${icon}</span>
                            <div>
                                <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${labelRuolo}</div>
                                <div style="font-weight:600; color:var(--text-main); font-size:1rem;">👑 ${nomeStampato}</div>
                            </div>
                        </div>
                        ${statoStr}
                    </div>
                `;
            });
        }
        
        const isFull = calcolaCoperturaRuolo(assegnazioni, turno.orario?.inizio || "00:00", turno.orario?.fine || "00:00").isFull;

        if (!isFull) {
            const eqCompleto = turno.equipaggio_attuale || {};
            const giaNelTurno = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => 
                eqCompleto[r] && eqCompleto[r].some(a => String(a.matricola) === myIdStr)
            );

            // Costruiamo myShifts con inizio e fine specifici dell'assegnazione
            const myShifts = fullTurniList.reduce((acc, t) => {
                if (t.id === turno.id) return acc;
                const e = t.equipaggio_attuale || {};
                ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                    if (e[r]) {
                        e[r].forEach(a => {
                            if (String(a.matricola) === myIdStr) {
                                acc.push({ data: t.data, inizio: a.inizio, fine: a.fine });
                            }
                        });
                    }
                });
                return acc;
            }, []);

            // Riposo checks for default shift times (will be re-checked in the modal with exact times)
            let riposoCheck = { idoneo: true, motivo: "" };
            try {
                if (typeof validaRiposi === 'function') {
                    riposoCheck = validaRiposi(turno.data, turno.orario?.inizio || "00:00", turno.orario?.fine || "00:00", myShifts);
                } else {
                    console.warn("Warning: validaRiposi is not defined. Ignorato controllo riposi.");
                }
            } catch (e) {
                console.error("Errore durante il controllo riposi in fase di render:", e);
            }
            const regole = verificaIscrizione(currentUser, turno, keyRuolo);
            let btnStr = '';

            if (giaNelTurno && !iAmInThisRole) {
                btnStr = '<span style="font-size:0.75rem; color:var(--neon-green)">Sei in un altro ruolo</span>';
            } else if (giaNelTurno && iAmInThisRole) {
                btnStr = `<button class="btn btn-take" data-turno="${turno.id}" data-ruolo="${keyRuolo}">Copri Altro Orario</button>`;
            } else if (isKioskMode) {
                btnStr = '';
            } else if (!riposoCheck.idoneo && !iAmInThisRole) {
                // Avvertimento generale, potrebbe iscriversi a slot che non viola
                btnStr = `<button class="btn btn-take" data-turno="${turno.id}" data-ruolo="${keyRuolo}">Verifica Orari</button>`;
            } else if (!regole.idoneo) {
                btnStr = `<span style="font-size:0.75rem; color:var(--text-muted);" title="${regole.motivo}">Non Idoneo</span>`;
            } else {
                btnStr = `<button class="btn btn-take" data-turno="${turno.id}" data-ruolo="${keyRuolo}">Prendi Turno</button>`;
            }

            html += `
                <div class="slot-row">
                    <div class="slot-info">
                        <span class="slot-icon" style="opacity:0.3">${icon}</span>
                        <div>
                            <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${labelRuolo}</div>
                            <div style="font-weight:600; color:var(--neon-red); font-style:italic; font-size:0.9rem;">🛞 [Posto Disponibile]</div>
                        </div>
                    </div>
                    ${btnStr}
                </div>
            `;
        }

        return html;
      };

      // =====================================================
      //  CORE: ISCRIZIONE E RIMOZIONE
      // =====================================================
      const rimuoviVolontario = async (idTurno, ruolo) => {
        if(!confirm("Sei sicuro di voler rimuovere te stesso dal turno?")) return;

        console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Rimozione da ${idTurno} ruolo ${ruolo}`);

        try {
            const docRef = doc(db, "turni", idTurno);
            
            await runTransaction(db, async (transaction) => {
                const turnoSnap = await transaction.get(docRef);
                if (!turnoSnap.exists()) throw "Il turno non esiste più nel database.";
                
                const turnoDataRaw = turnoSnap.data();
                const turnoData = sanificaTurno({ ...turnoDataRaw, orario: turnoDataRaw.orario || { inizio: "00:00", fine: "00:00" } });
                const eq = { ...turnoData.equipaggio_attuale };
                
                if (eq[ruolo]) {
                    eq[ruolo] = eq[ruolo].filter(a => String(a.matricola) !== String(currentUser.matricola));
                }

                const logs = turnoData.log_modifiche || [];
                logs.push({
                    timestamp: new Date().toISOString(),
                    autore: currentUser.matricola,
                    azione: `Rimozione utente per slot ${ruolo.replace(/_/g, ' ')}`,
                    notifica_inviata: false
                });

                console.log(`[DEBUG_DB] DATA_INVIO: Dati transazione calcolati`);

                transaction.update(docRef, {
                    equipaggio_attuale: eq,
                    log_modifiche: logs
                });
            });
            
            console.log(`[DEBUG_DB] CONFERMA_FIRESTORE: Rimozione confermata da DB`);
        } catch (err) {
            console.error("Errore rimozione:", err);
            alert("Si è verificato un errore di rete durante la rimozione o il turno non esiste più.");
        }
      };

      const iscriviti = async (idTurno, ruolo) => {
        // Modal for custom time selection
        const turnoObj = turniList.find(t => t.id === idTurno);
        if (!turnoObj) return;
        
        const myIdStr = String(currentUser.matricola);
        const myShifts = turniList.reduce((acc, t) => {
            if (t.id === idTurno) return acc;
            const e = t.equipaggio_attuale || {};
            ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                if (e[r]) e[r].forEach(a => {
                    if (String(a.matricola) === myIdStr) acc.push({ data: t.data, inizio: a.inizio, fine: a.fine });
                });
            });
            return acc;
        }, []);

        const shiftStart = turnoObj.orario?.inizio || "06:00";
        const shiftEnd = turnoObj.orario?.fine || "20:00";
        
        const userInizio = shiftStart;
        const userFine = shiftEnd;
        
        // Verifica riposi custom
        let riposoCheck = { idoneo: true, motivo: "" };
        try {
            if (typeof validaRiposi === 'function') {
                riposoCheck = validaRiposi(turnoObj.data, userInizio, userFine, myShifts);
            } else {
                console.warn("Warning: validaRiposi is not defined. Ignorato controllo riposi custom.");
            }
        } catch (e) {
            console.error("Errore durante il controllo riposi custom:", e);
        }
        
        if (!riposoCheck.idoneo) {
            alert(`Impossibile iscriverti: ${riposoCheck.motivo}`);
            return;
        }

        console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Iscrizione a ${idTurno} ruolo ${ruolo}`);

        try {
            const docRef = doc(db, "turni", idTurno);
            
            await runTransaction(db, async (transaction) => {
                const turnoSnap = await transaction.get(docRef);
                if (!turnoSnap.exists()) throw "Il turno non esiste più nel database.";
                
                const turnoDataRaw = turnoSnap.data();
                const turnoData = sanificaTurno({ ...turnoDataRaw, orario: turnoDataRaw.orario || { inizio: shiftStart, fine: shiftEnd } });
                const eq = { ...turnoData.equipaggio_attuale };
                
                const ruoloArr = eq[ruolo] || [];
                // Escludi l'utente corrente per evitare false "sovrapposizioni" con se stesso durante l'update/overwrite
                const filteredRuoloArr = ruoloArr.filter(a => String(a.matricola) !== String(currentUser.matricola));
                
                const checkOverlap = calcolaCoperturaRuolo([...filteredRuoloArr, { inizio: userInizio, fine: userFine }], shiftStart, shiftEnd);
                if (checkOverlap.overlaps) {
                    throw "Sovrapposizione di orari per lo stesso ruolo!";
                }

                const nuovoMembro = {
                    matricola: currentUser.matricola,
                    nominativo: formattaNominativoUtente(currentUser),
                    inizio: userInizio,
                    fine: userFine,
                    convalidato_da_admin: false,
                    is_dipendente: !!currentUser.is_dipendente
                };

                eq[ruolo] = [...filteredRuoloArr, nuovoMembro];

                const logs = turnoData.log_modifiche || [];
                logs.push({
                    timestamp: new Date().toISOString(),
                    autore: currentUser.matricola,
                    azione: `Iscrizione autonoma come ${ruolo.replace(/_/g, ' ')} (${userInizio}-${userFine})`,
                    notifica_inviata: false
                });

                console.log(`[DEBUG_DB] DATA_INVIO: Dati transazione calcolati per iscrizione`);

                transaction.update(docRef, {
                    equipaggio_attuale: eq,
                    log_modifiche: logs
                });
            });

            console.log(`[DEBUG_DB] CONFERMA_FIRESTORE: Iscrizione confermata da DB`);
        } catch (err) {
            console.error("Errore iscrizione:", err);
            alert(typeof err === "string" ? err : "Si è verificato un errore di rete durante l'iscrizione.");
        }
      };

      const modificaOrarioFine = async (idTurno, ruolo, orarioFineAttuale) => {
          const userFine = prompt("A che ora finisci?", orarioFineAttuale);
          if (!userFine || userFine === orarioFineAttuale) return;

          console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Modifica orario fine a ${idTurno} ruolo ${ruolo} per ${userFine}`);

          try {
              const docRef = doc(db, "turni", idTurno);
              
              await runTransaction(db, async (transaction) => {
                  const turnoSnap = await transaction.get(docRef);
                  if (!turnoSnap.exists()) throw "Il turno non esiste più nel database.";
                  
                  const turnoDataRaw = turnoSnap.data();
                  const turnoData = sanificaTurno({ ...turnoDataRaw, orario: turnoDataRaw.orario || { inizio: "00:00", fine: "00:00" } });
                  const eq = { ...turnoData.equipaggio_attuale };
                  
                  if (eq[ruolo]) {
                      const myIndex = eq[ruolo].findIndex(a => String(a.matricola) === String(currentUser.matricola));
                      if (myIndex !== -1) {
                          eq[ruolo][myIndex].fine = userFine;
                      } else {
                          throw "Non sei iscritto a questo turno.";
                      }
                  } else {
                      throw "Non sei iscritto a questo turno.";
                  }

                  const logs = turnoData.log_modifiche || [];
                  logs.push({
                      timestamp: new Date().toISOString(),
                      autore: currentUser.matricola,
                      azione: `Modifica orario fine per slot ${ruolo.replace(/_/g, ' ')} a ${userFine}`,
                      notifica_inviata: false
                  });

                  transaction.update(docRef, {
                      equipaggio_attuale: eq,
                      log_modifiche: logs
                  });
              });

              console.log(`[DEBUG_DB] CONFERMA_FIRESTORE: Modifica orario confermata da DB`);
          } catch (err) {
              console.error("Errore modifica orario:", err);
              alert(typeof err === "string" ? err : "Si è verificato un errore di rete durante la modifica.");
          }
      };
  }
});
