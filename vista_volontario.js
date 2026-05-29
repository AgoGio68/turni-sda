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
import { getFirestore, collection, query, onSnapshot, doc, updateDoc, getDoc } from "firebase/firestore";
import { verificaIscrizione, validaRiposi } from './regole_iscrizione.js';
import { formattaNominativoUtente, formattaNomeDisplay } from './utils.js';

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
      const q = query(collection(db, "turni")); 
      
      onSnapshot(q, (snapshot) => {
        turniList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderMacroCalendar();
        
        if (bottomSheet.classList.contains('active') && currentSelectedDate) {
          renderMicroDay(currentSelectedDate);
        }
      });

      const closeBottomSheet = () => {
        bottomSheet.classList.remove('active');
        bsOverlay.classList.remove('active');
        currentSelectedDate = null;
      };
      bsOverlay.addEventListener('click', closeBottomSheet);

      // =====================================================
      //  UTILITY: Verifica se l'utente è in un turno
      // =====================================================
      const getUserRoleInShift = (turno) => {
          const eq = turno.equipaggio_attuale || {};
          const myId = String(currentUser.matricola);
          if (eq.autista?.matricola && String(eq.autista.matricola) === myId) return 'Autista';
          if (eq.referente_soreu?.matricola && String(eq.referente_soreu.matricola) === myId) return 'Rif. SOREU';
          if (eq.soccorritore?.matricola && String(eq.soccorritore.matricola) === myId) return 'Soccorritore';
          if (eq.allievo_quarto_posto?.matricola && String(eq.allievo_quarto_posto.matricola) === myId) return 'Allievo';
          return null;
      };

      // =====================================================
      //  UTILITY: Rendering equipaggio inline ordinato
      // =====================================================
      const renderInlineEquipaggio = (turno) => {
          const eq = turno.equipaggio_attuale || {};
          const req = turno.requisiti_equipaggio || {};
          
          const slots = [];
          
          const addSlot = (key, label, membro, richiesto) => {
              if (!richiesto && key !== 'allievo_quarto_posto') return;
              if (key === 'allievo_quarto_posto' && !richiesto) return;
              
              if (membro?.matricola) {
                  const isMe = String(membro.matricola) === String(currentUser.matricola);
                  // Usa il nominativo già formattato se presente, altrimenti fallback
                  const nomeDb = membro.nominativo || 'Sconosciuto';
                  const nomeDisplay = nomeDb !== 'Sconosciuto' ? formattaNomeDisplay(nomeDb) : nomeDb;
                  slots.push({
                      label,
                      nome: nomeDisplay,
                      isMe,
                      isEmpty: false,
                      // Per ordinamento: estrai cognome dal nominativo "Cognome, Nome - Matricola"
                      sortKey: nomeDb
                  });
              } else {
                  slots.push({
                      label,
                      nome: 'DA COPRIRE',
                      isMe: false,
                      isEmpty: true,
                      sortKey: 'ZZZZZ' // va in fondo
                  });
              }
          };
          
          addSlot('autista', 'AUT', eq.autista, req.autista_richiesto);
          addSlot('referente_soreu', 'RIF', eq.referente_soreu, req.referente_richiesto);
          addSlot('soccorritore', 'SOC', eq.soccorritore, req.soccorritore_richiesto);
          addSlot('allievo_quarto_posto', 'ALL', eq.allievo_quarto_posto, req.allievo_consentito);
          
          // Ordinamento: nomi occupati in ordine alfabetico, vuoti in fondo
          slots.sort((a, b) => {
              if (a.isEmpty && !b.isEmpty) return 1;
              if (!a.isEmpty && b.isEmpty) return -1;
              return a.sortKey.localeCompare(b.sortKey, 'it', { sensitivity: 'base' });
          });
          
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
              
              const aut = !req.autista_richiesto || !!eq.autista?.matricola;
              const ref = !req.referente_richiesto || !!eq.referente_soreu?.matricola;
              const soc = !req.soccorritore_richiesto || !!eq.soccorritore?.matricola;
              const all = !req.allievo_consentito || !!eq.allievo_quarto_posto?.matricola;

              const isCritico = !aut || !ref || !soc;
              const isFull = aut && ref && soc && all;

              if (isCritico) anyCritical = true;
              if (!isFull) allFull = false;

              const oraInizio = parseInt((t.orario?.inizio || "08:00").split(':')[0]);
              let fascia = oraInizio < 13 ? 'M' : (oraInizio < 19 ? 'P' : 'N');
              let color = isCritico ? 'rosso' : (isFull ? 'verde' : 'giallo');
              
              if(fasce[fascia] === 'rosso') color = 'rosso'; 
              else if(fasce[fascia] === 'giallo' && color === 'verde') color = 'giallo';
              
              fasce[fascia] = color;
          });

          if(anyCritical) { badgeClass = 'critico'; statoDay = 'Critico'; }
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

            card.innerHTML = `
                <div class="shift-header">
                    <div>
                        <strong style="color:var(--text-main); font-size:1.1rem; letter-spacing: 0.5px;">${(turno.tipo_servizio||'').replace(/_/g, ' ')}</strong><br>
                        <span style="color:var(--text-muted); font-size:0.9rem;">🕒 ${turno.orario?.inizio} - ${turno.orario?.fine}</span>
                    </div>
                    <span class="badge ${turno.stato_turno === 'APERTO' ? 'incompleto' : (turno.stato_turno === 'CRITICO' ? 'critico' : 'convalidato')}">${turno.stato_turno}</span>
                </div>
                <div class="shift-slots">
                    ${renderSlotRow(turno, 'autista', 'AUTISTA', eq.autista, req.autista_richiesto, '🚑', turniList)}
                    ${renderSlotRow(turno, 'referente_soreu', 'SOCC. REFERENTE SOREU', eq.referente_soreu, req.referente_richiesto, '📞', turniList)}
                    ${renderSlotRow(turno, 'soccorritore', 'SOCCORRITORE', eq.soccorritore, req.soccorritore_richiesto, '🎒', turniList)}
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
      };

      // =====================================================
      //  RENDERING: SLOT ROW (invariato nella logica core)
      // =====================================================
      const renderSlotRow = (turno, keyRuolo, labelRuolo, membro, richiesto, icon, fullTurniList) => {
        if(!richiesto && keyRuolo !== 'allievo_quarto_posto') return ''; 
        if(keyRuolo === 'allievo_quarto_posto' && !richiesto) return ''; 

        if (membro?.matricola) {
            const isMe = String(membro.matricola) === String(currentUser.matricola);
            const nomeDb = membro.nominativo || 'Sconosciuto';
            const nomeDisplay = nomeDb !== 'Sconosciuto' ? formattaNomeDisplay(nomeDb) : nomeDb;
            const nomeStampato = isMe ? `<span style="color:var(--neon-green)">Tu (${nomeDisplay})</span>` : nomeDisplay;
            const statoStr = membro.convalidato_da_admin ? '<span class="status-badge status-conv">[CONVALIDATO]</span>' : '<span class="status-badge status-wait">[IN ATTESA]</span>';
            
            return `
                <div class="slot-row">
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
        } else {
            const eqCompleto = turno.equipaggio_attuale || {};
            const myIdStr = String(currentUser.matricola);
            const giaNelTurno = (eqCompleto.autista?.matricola && String(eqCompleto.autista.matricola) === myIdStr) || 
                                (eqCompleto.referente_soreu?.matricola && String(eqCompleto.referente_soreu.matricola) === myIdStr) ||
                                (eqCompleto.soccorritore?.matricola && String(eqCompleto.soccorritore.matricola) === myIdStr) ||
                                (eqCompleto.allievo_quarto_posto?.matricola && String(eqCompleto.allievo_quarto_posto.matricola) === myIdStr);

            const myShifts = fullTurniList.filter(t => {
                if (t.id === turno.id) return false;
                const e = t.equipaggio_attuale || {};
                return (e.autista?.matricola && String(e.autista.matricola) === myIdStr) || 
                       (e.referente_soreu?.matricola && String(e.referente_soreu.matricola) === myIdStr) ||
                       (e.soccorritore?.matricola && String(e.soccorritore.matricola) === myIdStr) ||
                       (e.allievo_quarto_posto?.matricola && String(e.allievo_quarto_posto.matricola) === myIdStr);
            }).map(t => ({
                data: t.data,
                inizio: t.orario?.inizio || "00:00",
                fine: t.orario?.fine || "00:00"
            }));

            const riposoCheck = validaRiposi(turno.data, turno.orario?.inizio || "00:00", turno.orario?.fine || "00:00", myShifts);
            const regole = verificaIscrizione(currentUser, turno, keyRuolo);
            let btnStr = '';

            if (giaNelTurno) {
                btnStr = '<span style="font-size:0.75rem; color:var(--neon-green)">Sei in questo equipaggio</span>';
            } else if (isKioskMode) {
                // Kiosk: nessun bottone, sola lettura
                btnStr = '';
            } else if (!riposoCheck.idoneo) {
                btnStr = `<span style="font-size:0.7rem; color:var(--neon-orange); text-align:right; max-width: 140px; line-height:1.2;" title="${riposoCheck.motivo}">Blocco 118:<br>${riposoCheck.motivo}</span>`;
            } else if (!regole.idoneo) {
                btnStr = `<span style="font-size:0.75rem; color:var(--text-muted);" title="${regole.motivo}">Non Idoneo</span>`;
            } else {
                btnStr = `<button class="btn btn-take" data-turno="${turno.id}" data-ruolo="${keyRuolo}">Prendi Turno</button>`;
            }

            return `
                <div class="slot-row">
                    <div class="slot-info">
                        <span class="slot-icon" style="opacity:0.3">${icon}</span>
                        <div>
                            <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${labelRuolo}</div>
                            <div style="font-weight:600; color:var(--neon-red); font-style:italic; font-size:0.9rem;">🛞 [Posto Vuoto]</div>
                        </div>
                    </div>
                    ${btnStr}
                </div>
            `;
        }
      };

      // =====================================================
      //  CORE: ISCRIZIONE (INVARIATA)
      // =====================================================
      const iscriviti = async (idTurno, ruolo) => {
        const turnoTarget = turniList.find(t => t.id === idTurno);
        if (!turnoTarget) return;

        try {
            const docRef = doc(db, "turni", idTurno);
            const eq = { ...turnoTarget.equipaggio_attuale };
            
            const nuovoMembro = {
                matricola: currentUser.matricola,
                nominativo: formattaNominativoUtente(currentUser),
                convalidato_da_admin: false
            };

            if (ruolo === 'autista') eq.autista = nuovoMembro;
            if (ruolo === 'referente_soreu') eq.referente_soreu = nuovoMembro;
            if (ruolo === 'soccorritore') eq.soccorritore = nuovoMembro;
            if (ruolo === 'allievo_quarto_posto') eq.allievo_quarto_posto = nuovoMembro;

            const logs = turnoTarget.log_modifiche || [];
            logs.push({
                timestamp: new Date().toISOString(),
                autore: currentUser.matricola,
                azione: `Iscrizione autonoma come ${ruolo.replace(/_/g, ' ')}`,
                notifica_inviata: false
            });

            await updateDoc(docRef, {
                equipaggio_attuale: eq,
                log_modifiche: logs
            });
            
        } catch (err) {
            console.error("Errore iscrizione:", err);
            alert("Si è verificato un errore di rete durante l'iscrizione.");
        }
      };
  }
});
