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
import { getFirestore, collection, query, onSnapshot, doc, getDoc, getDocs, where, runTransaction } from "firebase/firestore";
import { verificaIscrizione, validaRiposi } from './regole_iscrizione.js';
import { formattaNominativoUtente, formattaNomeDisplay, sanificaTurno, calcolaCoperturaRuolo, calcolaBuchiRuolo } from './utils.js';

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

document.addEventListener('DOMContentLoaded', () => {
  // =====================================================
  //  STATO GLOBALE SOTTO UN UNICO SCOPE CHIUSO
  // =====================================================
  let turniList = [];
  let currentSelectedDate = null;
  let currentFilter = 'focus'; 
  let currentUser = null;
  let activeUnsubscribeTurni = null;
  let isUpdating = false;

  // Elementi DOM mappati singolarmente
  const userInfoDiv = document.getElementById('user-info');
  const calendar = document.getElementById('calendar');
  const bottomSheet = document.getElementById('bottom-sheet');
  const bsOverlay = document.getElementById('bs-overlay');
  const bsTitle = document.getElementById('bs-title');
  const bsContent = document.getElementById('bs-content');
  const btnCloseDetails = document.getElementById('btn-close-details');
  const filterButtons = document.querySelectorAll('.filter-btn');
  const btnTv = document.getElementById('btn-tv-mode');

  // Rileva modalità Kiosk dall'URL
  const isKioskMode = new URLSearchParams(window.location.search).get('mode') === 'kiosk';
  let isTvMode = isKioskMode;

  if (!isKioskMode) {
      const isSuperAdminOverride = localStorage.getItem('superadmin_override') === 'true';
      if (isSuperAdminOverride) {
          window.location.href = "vista_responsabile.html";
          return;
      }
  }

  // =====================================================
  //  DELEGA GLOBALE DEI CLICK (UNICA ISTANZA)
  // =====================================================
  document.addEventListener('click', async (e) => {
      if (isUpdating) {
          console.warn("[DEBUG_DB] Blocco preventivo click: transazione in corso.");
          return;
      }

      // Case 1: Iscrizione standard (Prendi Turno con orario pre-calcolato)
      if (e.target.classList.contains('btn-take')) {
          const idTurno = e.target.getAttribute('data-turno');
          const ruolo = e.target.getAttribute('data-ruolo');
          const bucoInizio = e.target.getAttribute('data-buco-inizio');
          const bucoFine = e.target.getAttribute('data-buco-fine');
          await iscriviti(idTurno, ruolo, bucoInizio, bucoFine);
      }
      
      // Case 4: Assegnazione a un altro volontario (admin/responsabile)
      if (e.target.classList.contains('btn-assign-vol')) {
          const idTurno = e.target.getAttribute('data-turno');
          const ruolo = e.target.getAttribute('data-ruolo');
          const bucoInizio = e.target.getAttribute('data-buco-inizio');
          const bucoFine = e.target.getAttribute('data-buco-fine');
          await assegnaVolontario(idTurno, ruolo, bucoInizio, bucoFine);
      }
      
      // Case 2: Rimozione selettiva di un blocco di presenza
      if (e.target.classList.contains('btn-remove-vol')) {
          const idTurno = e.target.getAttribute('data-turno');
          const ruolo = e.target.getAttribute('data-ruolo');
          const inizio = e.target.getAttribute('data-inizio');
          await rimuoviVolontario(idTurno, ruolo, inizio);
      }
      
      // Case 3: Variazione istantanea dell'orario di fine turno
      if (e.target.classList.contains('btn-edit-time')) {
          const idTurno = e.target.getAttribute('data-turno');
          const ruolo = e.target.getAttribute('data-ruolo');
          const inizio = e.target.getAttribute('data-inizio');
          const orarioFine = e.target.getAttribute('data-fine');
          await modificaOrarioFine(idTurno, ruolo, inizio, orarioFine);
      }
  });

  // =====================================================
  //  GESTIONE FILTRI INTERFACCIA
  // =====================================================
  filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
          filterButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentFilter = btn.getAttribute('data-filter');
          renderMacroCalendar();
      });
  });

  if (isKioskMode) {
      currentFilter = 'tabellone';
      document.body.classList.add('tv-mode');
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.style.display = 'none';
      filterButtons.forEach(b => b.classList.remove('active'));
      const tabBtn = document.getElementById('filter-tabellone');
      if (tabBtn) tabBtn.classList.add('active');
      if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
      }
  }

  if (btnTv) {
      btnTv.addEventListener('click', () => {
          isTvMode = !isTvMode;
          document.body.classList.toggle('tv-mode', isTvMode);
          btnTv.textContent = isTvMode ? '↩️ Esci da Modalità TV' : '🖥️ Modalità TV (Fullscreen)';
          
          if (isTvMode) {
              currentFilter = 'tabellone';
              filterButtons.forEach(b => b.classList.remove('active'));
              document.getElementById('filter-tabellone').classList.add('active');
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
  }

  const closeBottomSheet = () => {
    bottomSheet.classList.remove('active');
    bsOverlay.classList.remove('active');
    if (btnCloseDetails) btnCloseDetails.classList.remove('active');
    currentSelectedDate = null;
  };
  bsOverlay.addEventListener('click', closeBottomSheet);
  if (btnCloseDetails) btnCloseDetails.addEventListener('click', closeBottomSheet);

  // =====================================================
  //  METODI DI RENDERING E LOGICA COMPONENTI
  // =====================================================
  const getUserRoleInShift = (turno) => {
      if (!currentUser) return null;
      const eq = turno.equipaggio_attuale || {};
      const myId = String(currentUser.matricola);
      if (eq.autista && eq.autista.some(a => String(a.matricola) === myId)) return 'Autista';
      if (eq.referente_soreu && eq.referente_soreu.some(a => String(a.matricola) === myId)) return 'Rif. SOREU';
      if (eq.soccorritore && eq.soccorritore.some(a => String(a.matricola) === myId)) return 'Soccorritore';
      if (eq.allievo_quarto_posto && eq.allievo_quarto_posto.some(a => String(a.matricola) === myId)) return 'Allievo';
      return null;
  };

  const renderInlineEquipaggio = (turno) => {
      const eq = turno.equipaggio_attuale || {};
      const req = turno.requisiti_equipaggio || {};
      const slots = [];
      
      const addSlot = (key, label, assegnazioni, richiesto) => {
          if (!richiesto && key !== 'allievo_quarto_posto') return;
          if (key === 'allievo_quarto_posto' && !richiesto) return;
          
          if (assegnazioni && assegnazioni.length > 0) {
              assegnazioni.forEach(membro => {
                  const isMe = currentUser && String(membro.matricola) === String(currentUser.matricola);
                  const nomeDb = membro.nominativo || 'Sconosciuto';
                  const nomeDisplay = nomeDb !== 'Sconosciuto' ? formattaNomeDisplay(nomeDb) : nomeDb;
                  const textColor = membro.convalidato_da_admin ? '#32CD32' : '#FFD700';
                  slots.push({
                      label,
                      nome: `<span style="color:${textColor}; font-weight:bold;">${nomeDisplay}</span> (${membro.inizio}-${membro.fine})`,
                      isMe,
                      isEmpty: false
                  });
              });
          } else {
              slots.push({ label, nome: 'DA COPRIRE', isMe: false, isEmpty: true });
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

  const renderMacroCalendar = () => {
    calendar.innerHTML = '';
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
      
      if (isMyDay) card.classList.add('my-shift');
      
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

      const formattedDate = `${dataString.split('-')[2]}/${dataString.split('-')[1]}`;
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
      
      if (currentFilter === 'focus') {
          const microBarRow = (label, fasciaKey) => {
              const myRole = myRolesPerFascia[fasciaKey];
              const badgeHTML = myRole ? ` <span class="my-role-badge">${myRole}</span>` : '';
              return `
                  <span class="micro-bar-label">${label}${badgeHTML}</span>
                  <div class="micro-bar ${fasce[fasciaKey] || ''} ${myRole ? 'my-micro-bar' : ''}"></div>
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

  const renderMicroDay = (dataString) => {
    bsTitle.textContent = `Turni del ${dataString.split('-').reverse().join('/')}`;
    bsContent.innerHTML = '';
    const turniDelGiorno = turniList.filter(t => t.data === dataString).sort((a,b) => (a.orario?.inizio||'').localeCompare(b.orario?.inizio||''));

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
        
        if (!aut || !ref || !soc) currentStato = 'INCOMPLETO';
        else if (currentStato !== 'CONVALIDATO') currentStato = 'COMPLETO';
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
                ${renderSlotRow(turno, 'autista', 'AUTISTA', eq.autista, req.autista_richiesto, '🚑')}
                ${renderSlotRow(turno, 'referente_soreu', 'SOCC. REFERENTE SOREU', eq.referente_soreu, req.referente_richiesto, '📞')}
                ${renderSlotRow(turno, 'soccorritore', 'OPERATORE DAE', eq.soccorritore, req.soccorritore_richiesto, '🎒')}
                ${renderSlotRow(turno, 'allievo_quarto_posto', 'ALLIEVO 4° POSTO', eq.allievo_quarto_posto, req.allievo_consentito, '🔰')}
            </div>
        `;
        bsContent.appendChild(card);
    });
  };

  const renderSlotRow = (turno, keyRuolo, labelRuolo, assegnazioni, richiesto, icon) => {
    if(!richiesto && keyRuolo !== 'allievo_quarto_posto') return ''; 
    if(keyRuolo === 'allievo_quarto_posto' && !richiesto) return ''; 

    let html = '';
    const myIdStr = currentUser ? String(currentUser.matricola) : '';
    let iAmInThisRole = false;

    if (assegnazioni && assegnazioni.length > 0) {
        assegnazioni.forEach(membro => {
            const isMe = String(membro.matricola) === myIdStr;
            if (isMe) iAmInThisRole = true;
            
            const nomeDb = membro.nominativo || 'Sconosciuto';
            const nomeDisplay = nomeDb !== 'Sconosciuto' ? formattaNomeDisplay(nomeDb) : nomeDb;
            const textColor = membro.convalidato_da_admin ? '#32CD32' : '#FFD700';
            const textContent = isMe ? `Tu (${nomeDisplay}) [${membro.inizio}-${membro.fine}]` : `${nomeDisplay} [${membro.inizio}-${membro.fine}]`;
            
            const isAdmin = currentUser && (currentUser.ruolo === 'admin' || currentUser.ruolo === 'superadmin' || currentUser.is_admin === true);
            const btnRemoveHtml = (isAdmin || isMe) ? `<button class="btn-remove-vol" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-inizio="${membro.inizio}" title="Rimuovi" style="background:transparent; border:none; cursor:pointer; margin-left:0.5rem;">❌</button>` : '';
            const btnEditHtml = isMe ? `<button class="btn-edit-time" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-inizio="${membro.inizio}" data-fine="${membro.fine}" title="Modifica Orario Fine" style="background:transparent; border:none; cursor:pointer; margin-left:0.2rem; font-size:1rem;">✏️</button>` : '';
            const statusBadge = membro.convalidato_da_admin ? '<span class="status-badge status-conv">[CONVALIDATO]</span>' : '<span class="status-badge status-wait">[IN ATTESA]</span>';
            const rowColorClass = membro.convalidato_da_admin ? 'slot-confermato' : 'slot-prenotato';

            html += `
                <div class="slot-row ${rowColorClass}">
                    <div class="slot-info">
                        <span class="slot-icon">${icon}</span>
                        <div>
                            <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${labelRuolo}</div>
                            <div style="font-weight:600; color:${textColor}; font-size:1rem;">${textContent} ${btnEditHtml} ${btnRemoveHtml}</div>
                        </div>
                    </div>
                    ${statusBadge}
                </div>
            `;
        });
    }
    
    const inizioTurno = turno.orario?.inizio || "00:00";
    const fineTurno = turno.orario?.fine || "00:00";
    const isFull = calcolaCoperturaRuolo(assegnazioni, inizioTurno, fineTurno).isFull;

    if (!isFull) {
        // --- OBIETTIVO 1: Calcolo matematico dei segmenti orari scoperti ---
        const buchiOrario = calcolaBuchiRuolo(assegnazioni, inizioTurno, fineTurno);

        const eqCompleto = turno.equipaggio_attuale || {};
        const giaNelTurno = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => 
            eqCompleto[r] && eqCompleto[r].some(a => String(a.matricola) === myIdStr)
        );
        const isAdmin = currentUser && (currentUser.ruolo === 'admin' || currentUser.ruolo === 'superadmin' || currentUser.is_admin === true);

        const myShifts = turniList.reduce((acc, t) => {
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

        let riposoCheck = { idoneo: true, motivo: "" };
        if (typeof validaRiposi === 'function') {
            riposoCheck = validaRiposi(turno.data, turno.orario?.inizio || "00:00", turno.orario?.fine || "00:00", myShifts);
        }
        const regole = verificaIscrizione(currentUser, turno, keyRuolo);

        // --- OBIETTIVO 2: Un pulsante per ogni buco orario scoperto ---
        buchiOrario.forEach(buco => {
            const bucoLabel = `${buco.inizio}-${buco.fine}`;
            let btnStr = '';

            if (giaNelTurno && !iAmInThisRole) {
                btnStr = '<span style="font-size:0.75rem; color:var(--neon-green)">Sei in un altro ruolo</span>';
            } else if (isAdmin || (giaNelTurno && iAmInThisRole)) {
                // Admin o già nel ruolo → Assegna un altro volontario per matricola
                btnStr = `<button class="btn btn-assign-vol" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-buco-inizio="${buco.inizio}" data-buco-fine="${buco.fine}">👤 Assegna Volontario</button>`;
            } else if (isKioskMode) {
                btnStr = '';
            } else if (!riposoCheck.idoneo && !iAmInThisRole) {
                btnStr = `<button class="btn btn-take" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-buco-inizio="${buco.inizio}" data-buco-fine="${buco.fine}">Verifica Orari</button>`;
            } else if (!regole.idoneo) {
                btnStr = `<span style="font-size:0.75rem; color:var(--text-muted);" title="${regole.motivo}">Non Idoneo</span>`;
            } else {
                // Volontario standard idoneo → Prendi Turno con orario pre-calcolato
                btnStr = `<button class="btn btn-take" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-buco-inizio="${buco.inizio}" data-buco-fine="${buco.fine}">Prendi Turno (${bucoLabel})</button>`;
            }

            html += `
                <div class="slot-row">
                    <div class="slot-info">
                        <span class="slot-icon" style="opacity:0.3">${icon}</span>
                        <div>
                            <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${labelRuolo}</div>
                            <div style="font-weight:600; color:var(--neon-red); font-style:italic; font-size:0.9rem;">⏱ Scoperto: ${bucoLabel}</div>
                        </div>
                    </div>
                    ${btnStr}
                </div>
            `;
        });
    }

    return html;
  };

  // =====================================================
  //  CORE AZIONI TRANSATTIVE FIRESTORE
  // =====================================================
  const rimuoviVolontario = async (idTurno, ruolo, inizioSelezionato) => {
    if(!confirm("Sei sicuro di voler rimuovere te stesso da questo segmento orario?")) return;

    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Rimozione da ${idTurno}, ruolo ${ruolo}, inizio ${inizioSelezionato}`);
    isUpdating = true;

    try {
        const docRef = doc(db, "turni", idTurno);
        await runTransaction(db, async (transaction) => {
            const turnoSnap = await transaction.get(docRef);
            if (!turnoSnap.exists()) throw "Turno non trovato";

            const data = turnoSnap.data();
            let equipaggio = data.equipaggio_attuale || {};
            
            if (equipaggio[ruolo] && !Array.isArray(equipaggio[ruolo])) {
                const vals = Object.values(equipaggio[ruolo]).filter(v => v && typeof v === 'object' && v.matricola);
                equipaggio[ruolo] = vals;
            }
            if (equipaggio[ruolo]) {
                equipaggio[ruolo] = equipaggio[ruolo].filter(m => 
                    !(String(m.matricola) === String(currentUser.matricola) && m.inizio === inizioSelezionato)
                );
            }
            transaction.update(docRef, { equipaggio_attuale: equipaggio });
        });
        console.log("[DEBUG_DB] CONFERMA_FIRESTORE: Rimozione completata con successo.");
    } catch (e) {
        console.error("Errore rimozione:", e);
    } finally {
        isUpdating = false;
        // Rendering delegato a onSnapshot per dati sempre freschi
    }
  };

  // --- OBIETTIVO 2: Assegnazione volontario per COGNOME (con fallback matricola) ---
  const assegnaVolontario = async (idTurno, ruolo, bucoInizio, bucoFine) => {
    const inputRicerca = prompt(
        `Assegna un volontario per coprire ${bucoInizio}-${bucoFine}.\nInserisci il Cognome del volontario da cercare:`
    );
    if (!inputRicerca) return;
    const termineRicerca = inputRicerca.trim();
    if (!termineRicerca) return;

    let utenteData = null;
    let matricola = null;

    try {
        // Ricerca per cognome: proviamo diverse capitalizzazioni
        const tentativi = [
            termineRicerca,
            termineRicerca.charAt(0).toUpperCase() + termineRicerca.slice(1).toLowerCase(),
            termineRicerca.toUpperCase()
        ];
        // Rimuovi duplicati
        const tentativiUnici = [...new Set(tentativi)];

        let risultati = null;
        for (const tentativo of tentativiUnici) {
            const qCognome = query(collection(db, "utenti"), where("cognome", "==", tentativo));
            const snap = await getDocs(qCognome);
            if (snap.size > 0) {
                risultati = snap;
                break;
            }
        }

        if (risultati && risultati.size === 1) {
            // Match singolo: usa direttamente
            matricola = risultati.docs[0].id;
            utenteData = risultati.docs[0].data();
        } else if (risultati && risultati.size > 1) {
            // Match multiplo: chiedi all'utente di scegliere
            let elenco = '';
            risultati.docs.forEach((d, i) => {
                const u = d.data();
                elenco += `${i + 1}. ${u.cognome || ''} ${u.nome || ''} (Matr. ${d.id})\n`;
            });
            const scelta = prompt(
                `Trovati ${risultati.size} volontari:\n${elenco}\nInserisci il numero corrispondente:`
            );
            if (!scelta) return;
            const idx = parseInt(scelta) - 1;
            if (idx >= 0 && idx < risultati.size) {
                matricola = risultati.docs[idx].id;
                utenteData = risultati.docs[idx].data();
            } else {
                alert('Selezione non valida.');
                return;
            }
        } else {
            // Fallback: prova come matricola diretta
            const snapMatricola = await getDoc(doc(db, "utenti", termineRicerca));
            if (snapMatricola.exists()) {
                matricola = termineRicerca;
                utenteData = snapMatricola.data();
            } else {
                alert(`Nessun volontario trovato per "${termineRicerca}".\nProva con il cognome esatto o la matricola.`);
                return;
            }
        }
    } catch (e) {
        console.error('Errore ricerca volontario:', e);
        alert('Errore durante la ricerca del volontario.');
        return;
    }

    const nominativo = `${utenteData.cognome || ''} ${utenteData.nome || ''}`.trim() || 'Sconosciuto';
    if (!confirm(`Confermi l'assegnazione di ${nominativo} (Matr. ${matricola}) per ${bucoInizio}-${bucoFine}?`)) return;

    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Assegnazione volontario ${matricola} a ${idTurno} ruolo ${ruolo} per ${bucoInizio}-${bucoFine}`);
    isUpdating = true;

    try {
        const docRef = doc(db, "turni", idTurno);
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (!snap.exists()) throw "Turno non trovato";
            let equipaggio = snap.data().equipaggio_attuale || {};
            // Sicurezza: converti formati legacy in array
            if (!equipaggio[ruolo] || !Array.isArray(equipaggio[ruolo])) {
                const old = equipaggio[ruolo];
                equipaggio[ruolo] = (old && typeof old === 'object') 
                    ? Object.values(old).filter(v => v && typeof v === 'object' && v.matricola) 
                    : [];
            }

            equipaggio[ruolo].push({
                matricola: matricola,
                nominativo: nominativo,
                inizio: bucoInizio,
                fine: bucoFine,
                convalidato_da_admin: false
            });
            transaction.update(docRef, { equipaggio_attuale: equipaggio });
        });
        console.log("[DEBUG_DB] CONFERMA_FIRESTORE: Assegnazione volontario confermata da DB");
    } catch (e) {
        console.error("Errore assegnazione volontario:", e);
        alert("Errore nell'assegnazione: " + e);
    } finally {
        isUpdating = false;
        // Rendering delegato a onSnapshot per dati sempre freschi
    }
  };

  const iscriviti = async (idTurno, ruolo, bucoInizio, bucoFine) => {
    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Iscrizione a ${idTurno} ruolo ${ruolo} orario ${bucoInizio}-${bucoFine}`);
    isUpdating = true;

    try {
        const docRef = doc(db, "turni", idTurno);
        await runTransaction(db, async (transaction) => {
            const turnoSnap = await transaction.get(docRef);
            if (!turnoSnap.exists()) throw "Turno non trovato";

            const turnoData = turnoSnap.data();
            let equipaggio = turnoData.equipaggio_attuale || {};
            // Sicurezza: converti formati legacy in array
            if (!equipaggio[ruolo] || !Array.isArray(equipaggio[ruolo])) {
                const old = equipaggio[ruolo];
                equipaggio[ruolo] = (old && typeof old === 'object') 
                    ? Object.values(old).filter(v => v && typeof v === 'object' && v.matricola) 
                    : [];
            }

            // Orario pre-calcolato dal buco residuo, nessun prompt necessario
            const oraInizio = bucoInizio || turnoData.orario?.inizio || "08:00";
            const oraFine = bucoFine || turnoData.orario?.fine || "14:00";

            const nuovoMembro = {
                matricola: currentUser.matricola,
                nominativo: `${currentUser.cognome} ${currentUser.nome}`,
                inizio: oraInizio,
                fine: oraFine,
                convalidato_da_admin: false
            };

            console.log("[DEBUG_DB] DATA_INVIO: Dati transazione calcolati per iscrizione", nuovoMembro);
            equipaggio[ruolo].push(nuovoMembro);
            transaction.update(docRef, { equipaggio_attuale: equipaggio });
        });
        console.log("[DEBUG_DB] CONFERMA_FIRESTORE: Iscrizione confermata da DB");
    } catch (error) {
        console.error("Errore iscrizione:", error);
    } finally {
        isUpdating = false;
        // Rendering delegato a onSnapshot per dati sempre freschi
    }
  };

  const modificaOrarioFine = async (idTurno, ruolo, inizioSelezionato, orarioFineAttuale) => {
    const nuovoOrarioFine = prompt(`Modifica l'orario di fine per questo blocco (Inizio: ${inizioSelezionato}):`, orarioFineAttuale);
    if (!nuovoOrarioFine) return;

    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nuovoOrarioFine.trim())) {
        alert("Formato non valido! Usa il formato HH:MM (es. 19:00)");
        return;
    }

    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Modifica orario fine a ${idTurno} ruolo ${ruolo} per ${nuovoOrarioFine} (Inizio: ${inizioSelezionato})`);
    isUpdating = true;

    try {
        const docRef = doc(db, "turni", idTurno);
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (!snap.exists()) throw "Turno non trovato";
            
            const data = snap.data();
            let equipaggio = data.equipaggio_attuale || {};
            
            if (equipaggio[ruolo] && !Array.isArray(equipaggio[ruolo])) {
                const vals = Object.values(equipaggio[ruolo]).filter(v => v && typeof v === 'object' && v.matricola);
                equipaggio[ruolo] = vals;
            }
            if (equipaggio[ruolo]) {
                equipaggio[ruolo] = equipaggio[ruolo].map(m => {
                    if (String(m.matricola) === String(currentUser.matricola) && m.inizio === inizioSelezionato) {
                        return { ...m, fine: nuovoOrarioFine.trim() };
                    }
                    return m;
                });
            }
            transaction.update(docRef, { equipaggio_attuale: equipaggio });
        });
        console.log("[DEBUG_DB] CONFERMA_FIRESTORE: Modifica orario confermata da DB");
    } catch (e) {
        console.error("Errore durante la modifica dell'orario:", e);
        alert("Errore nell'aggiornamento: " + e);
    } finally {
        isUpdating = false;
        // Rendering delegato a onSnapshot per dati sempre freschi
    }
  };

  // =====================================================
  //  FIRESTORE REAL-TIME LISTENER E AUTENTICAZIONE
  // =====================================================
  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        const matricola = user.email.split('@')[0];
        if (isKioskMode) {
            currentUser = { matricola: 'kiosk', nome: 'Tabellone', cognome: 'Kiosk', is_kiosk: true };
            userInfoDiv.innerHTML = `<span style="color:var(--neon-orange);">🖥️ Modalità Tabellone (Sola Lettura)</span>`;
            startTurniSnapshot();
            return;
        }
        if (matricola.toLowerCase() === 'agogio') {
           localStorage.setItem('superadmin_override', 'true');
           window.location.href = "vista_responsabile.html";
           return;
        }

        const snap = await getDoc(doc(db, "utenti", matricola));
        if (snap.exists()) {
          currentUser = snap.data();
          let adminBtnHTML = currentUser.is_admin ? `<button id="btn-goto-admin" class="btn" style="margin-left:1rem; padding:0.3rem 0.6rem; font-size:0.8rem; border-color:var(--neon-green); color:var(--neon-green); background:rgba(57,255,20,0.1);">Accedi a Programmazione</button>` : "";

          userInfoDiv.innerHTML = `Profilo: ${formattaNominativoUtente(currentUser)} ${adminBtnHTML} <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
          document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
          if (currentUser.is_admin) {
              document.getElementById('btn-goto-admin').addEventListener('click', () => { window.location.href = "vista_responsabile.html"; });
          }
          startTurniSnapshot();
        } else {
          alert("Profilo volontario non trovato nel database.");
          signOut(auth);
        }
      } else {
        window.location.href = "index.html";
      }
    } catch (e) {
      console.error("Errore onAuthStateChanged:", e);
    }
  });

  function startTurniSnapshot() {
      if (activeUnsubscribeTurni) activeUnsubscribeTurni();
      const q = query(collection(db, "turni")); 
      
      activeUnsubscribeTurni = onSnapshot(q, (snapshot) => {
        turniList = snapshot.docs.map(doc => sanificaTurno({ id: doc.id, ...doc.data() }));
        console.log("[DEBUG_DB] onSnapshot ricevuto dal server. Aggiorno la vista graficamente.");
        
        renderMacroCalendar();
        if (bottomSheet.classList.contains('active') && currentSelectedDate) {
          renderMicroDay(currentSelectedDate);
        }
      });
  }

});