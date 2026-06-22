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
import { getFirestore, collection, query, onSnapshot, doc, getDoc, getDocs, runTransaction, addDoc, deleteDoc } from "firebase/firestore";
import { verificaIscrizione, validaRiposi } from './regole_iscrizione.js';
import { formattaNominativoUtente, formattaNomeDisplay, sanificaTurno, calcolaCoperturaRuolo, calcolaBuchiRuolo, timeToMinutes } from './utils.js';

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
  let disponibilitaList = [];
  let currentSelectedDate = null;
  let currentFilter = 'focus'; 
  let currentView = 'ufficiale'; 
  let currentUser = null;
  let activeUnsubscribeTurni = null;
  let activeUnsubscribeDisponibilita = null;
  let isUpdating = false;
  let utentiCache = null; // Cache lista volontari per il modal admin
  
  let configLive = { controllaRiposoVolontari: true, controllaRiposoDipendenti: false, applicaRegoleAdmin: false };
  let configUnsubscribe = null;

  // Elementi DOM mappati singolarmente
  const userInfoDiv = document.getElementById('user-info');
  const calendar = document.getElementById('calendar');
  const bottomSheet = document.getElementById('bottom-sheet');
  const bsOverlay = document.getElementById('bs-overlay');
  const bsTitle = document.getElementById('bs-title');
  const bsContent = document.getElementById('bs-content');
  const btnCloseDetails = document.getElementById('btn-close-details');
  const filterButtons = document.querySelectorAll('#container-filtri-ufficiali .filter-btn');
  const btnViewUfficiale = document.getElementById('btn-view-ufficiale');
  const btnViewDisponibilita = document.getElementById('btn-view-disponibilita');
  const containerFiltriUfficiali = document.getElementById('container-filtri-ufficiali');
  const btnTv = document.getElementById('btn-tv-mode');

  // Elementi DOM del modal picker volontario
  const volPickerOverlay = document.getElementById('vol-picker-overlay');
  const volPickerSearch = document.getElementById('vol-picker-search');
  const volPickerList = document.getElementById('vol-picker-list');
  const volPickerEmpty = document.getElementById('vol-picker-empty');
  const volPickerSubtitle = document.getElementById('vol-picker-subtitle');
  const volPickerClose = document.getElementById('vol-picker-close');

  // =====================================================
  //  MODAL PICKER VOLONTARIO — Logica apri/chiudi/cerca
  // =====================================================
  const closeVolPicker = () => {
      volPickerOverlay.classList.remove('active');
      volPickerSearch.value = '';
  };
  volPickerClose.addEventListener('click', closeVolPicker);
  volPickerOverlay.addEventListener('click', (e) => {
      if (e.target === volPickerOverlay) closeVolPicker();
  });

  // Filtra la lista in base al testo di ricerca
  volPickerSearch.addEventListener('input', () => {
      const q = volPickerSearch.value.trim().toLowerCase();
      let found = 0;
      volPickerList.querySelectorAll('.volunteer-item').forEach(el => {
          const matches = el.dataset.searchKey.includes(q);
          el.style.display = matches ? '' : 'none';
          if (matches) found++;
      });
      volPickerEmpty.style.display = found === 0 ? 'block' : 'none';
  });

  // Apre il modal e ritorna una Promise che si risolve con { matricola, nominativo } o null
  const apriVolPicker = async (bucoInizio, bucoFine, turno, keyRuolo) => {
      // Carica utenti una sola volta e li mette in cache
      if (!utentiCache) {
          volPickerList.innerHTML = '<div style="text-align:center;padding:2rem;"><div class="spinner"></div><p style="color:var(--text-muted);font-size:0.85rem;">Caricamento volontari...</p></div>';
          volPickerEmpty.style.display = 'none';
          volPickerOverlay.classList.add('active');
          try {
              const snap = await getDocs(collection(db, 'utenti'));
              utentiCache = snap.docs
                  .map(d => ({ id: d.id, ...d.data() }))
                  .filter(u => u.attivo !== false)
                  .sort((a, b) => {
                      const ca = (a.cognome || '').trim().toLowerCase();
                      const cb = (b.cognome || '').trim().toLowerCase();
                      return ca.localeCompare(cb, 'it');
                  });
          } catch (err) {
              console.error('Errore caricamento utenti:', err);
              volPickerList.innerHTML = '<p style="color:var(--neon-red);text-align:center;">Errore caricamento volontari.</p>';
              return null;
          }
      } else {
          volPickerOverlay.classList.add('active');
      }

      // Aggiorna subtitle con il buco orario
      volPickerSubtitle.textContent = `Copertura richiesta: ${bucoInizio} - ${bucoFine}`;

      // Renderizza la lista
      volPickerList.innerHTML = '';
      volPickerSearch.value = '';
      volPickerEmpty.style.display = 'none';
      let foundVolunteers = 0;

      utentiCache.forEach(u => {
          const controlloMansione = verificaIscrizione(u, turno, keyRuolo);
          if (!controlloMansione.idoneo) return;

          const giaNelTurno = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => {
              if (r === keyRuolo) return false;
              const slot = turno.equipaggio_attuale?.[r];
              if (!slot) return false;
              const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
              return slotArr.some(a => a && a.matricola && (String(a.matricola) === String(u.id) || String(a.matricola) === String(u.matricola)));
          });
          if (giaNelTurno) return;

          const turniVolontario = turniList.reduce((acc, t) => {
              if (t.id === turno.id) return acc;
              const e = t.equipaggio_attuale || {};
              ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].forEach(r => {
                  if (e[r]) {
                      e[r].forEach(a => {
                          if (String(a.matricola) === String(u.id) || String(a.matricola) === String(u.matricola)) {
                              acc.push({ data: t.data, inizio: a.inizio, fine: a.fine });
                          }
                      });
                  }
              });
              return acc;
          }, []);

          let riposoCheck = { idoneo: true, motivo: "" };
          const utenteTipoRapporto = u.tipoRapporto || "Volontario";
          const isRuleActive = (utenteTipoRapporto === "Volontario" && configLive.controllaRiposoVolontari) || 
                               (utenteTipoRapporto === "Dipendente" && configLive.controllaRiposoDipendenti);

          if (isRuleActive) {
              if (typeof validaRiposi === 'function') {
                  riposoCheck = validaRiposi(turno.data, bucoInizio, bucoFine, turniVolontario);
              }
          }
          // If admin bypass is OFF, skip the rest check for admins
          const isAdminUser = currentUser && (currentUser.ruolo === 'admin' || currentUser.ruolo === 'superadmin' || currentUser.is_admin === true);
          if (isRuleActive && !riposoCheck.idoneo && (!isAdminUser || configLive.applicaRegoleAdmin)) return;

          foundVolunteers++;
          const nome = `${(u.cognome || '').trim()} ${(u.nome || '').trim()}`.trim();
          const mansione = u.mansione || u.ruoli_areu?.[0] || '';
          const item = document.createElement('button');
          item.className = 'volunteer-item';
          item.dataset.searchKey = `${nome} ${u.id}`.toLowerCase();
          item.innerHTML = `
              <div>
                  <div style="font-weight:700; font-size:0.9rem; color:var(--text-main);">${nome}</div>
                  <div style="font-size:0.72rem; color:var(--text-muted); margin-top:2px;">${mansione} &nbsp;·&nbsp; Matr. ${u.id}</div>
              </div>
              <span style="font-size:0.75rem; color:var(--neon-green); font-weight:600;">✔ Seleziona</span>
          `;
          item.addEventListener('click', () => {
              closeVolPicker();
              // Risolvi la promise iniettando il risultato nel contesto chiamante
              volPickerOverlay._resolve({ matricola: u.id, nominativo: nome });
          });
          volPickerList.appendChild(item);
      });

      if (foundVolunteers === 0) {
          volPickerEmpty.style.display = 'block';
      }

      volPickerSearch.focus();

      // Ritorna una Promise che aspetta la selezione o la chiusura
      return new Promise((resolve) => {
          volPickerOverlay._resolve = resolve;
          // Se l'utente chiude il modal senza selezionare
          const onClose = () => {
              volPickerClose.removeEventListener('click', onClose);
              resolve(null);
          };
          // Aggiungi handler one-shot per la X (sovrascrive il closeVolPicker generico)
          volPickerClose.addEventListener('click', onClose, { once: true });
          volPickerOverlay.addEventListener('click', (e) => {
              if (e.target === volPickerOverlay) resolve(null);
          }, { once: true });
      });
  };

  // Rileva modalità Kiosk dall'URL
  const isKioskMode = new URLSearchParams(window.location.search).get('mode') === 'kiosk';
  let isTvMode = isKioskMode;

  if (!isKioskMode) {
      // Nessun bypass: tutti gli utenti passano per onAuthStateChanged
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

  if (btnViewUfficiale && btnViewDisponibilita) {
      btnViewUfficiale.addEventListener('click', () => {
          btnViewDisponibilita.classList.remove('active');
          btnViewUfficiale.classList.add('active');
          if (containerFiltriUfficiali) containerFiltriUfficiali.style.display = 'block';
          currentView = 'ufficiale';
          renderMacroCalendar();
      });

      btnViewDisponibilita.addEventListener('click', () => {
          btnViewUfficiale.classList.remove('active');
          btnViewDisponibilita.classList.add('active');
          if (containerFiltriUfficiali) containerFiltriUfficiali.style.display = 'none';
          currentView = 'disponibilita';
          renderMacroCalendar();
      });
  }

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
  //  SWIPE-TO-CLOSE BOTTOM SHEET (Proposta F)
  // =====================================================
  let touchStartY = 0;
  bottomSheet.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
  }, { passive: true });
  bottomSheet.addEventListener('touchend', (e) => {
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (deltaY > 60) {
          closeBottomSheet();
      }
  }, { passive: true });

  // =====================================================
  //  BOTTOM NAVIGATION BAR (Proposta A — mobile only)
  // =====================================================
  const bottomNavTabs = document.querySelectorAll('.bottom-nav-tab');

  const setActiveNavTab = (navKey) => {
      bottomNavTabs.forEach(t => t.classList.toggle('active', t.dataset.nav === navKey));
  };

  bottomNavTabs.forEach(tab => {
      tab.addEventListener('click', () => {
          const nav = tab.dataset.nav;

          if (nav === 'ufficiale' || nav === 'disponibilita') {
              // Cambia la Vista (ufficiale / disponibilita)
              if (nav === 'ufficiale') {
                  if (btnViewUfficiale) btnViewUfficiale.click();
              } else {
                  if (btnViewDisponibilita) btnViewDisponibilita.click();
              }
              setActiveNavTab(nav);
          } else {
              // Cambia il Filtro (focus / miei / tabellone) — rimane nella vista ufficiale
              if (currentView !== 'ufficiale') {
                  if (btnViewUfficiale) btnViewUfficiale.click();
              }
              const targetBtn = document.getElementById(`filter-${nav}`);
              if (targetBtn) targetBtn.click();
              setActiveNavTab(nav);
          }
      });
  });

  // Sincronizza la bottom nav con i click sulla sidebar (desktop → mobile coerenza)
  filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
          const f = btn.getAttribute('data-filter');
          if (f) setActiveNavTab(f);
      });
  });
  if (btnViewUfficiale) {
      btnViewUfficiale.addEventListener('click', () => setActiveNavTab('ufficiale'));
  }
  if (btnViewDisponibilita) {
      btnViewDisponibilita.addEventListener('click', () => setActiveNavTab('disponibilita'));
  }

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
    
    // Raccoglie tutte le date dai turni per creare la griglia
    const turniPerData = turniList.reduce((acc, turno) => {
        if(!acc[turno.data]) acc[turno.data] = [];
        acc[turno.data].push(turno);
        return acc;
    }, {});

    const dateOrdinate = Object.keys(turniPerData).sort();

    if (currentView === 'ufficiale') {
        let turniDaRendere = turniList;
        if (currentFilter === 'miei') {
            turniDaRendere = turniList.filter(t => getUserRoleInShift(t) !== null);
        }
        
        const filteredTurniPerData = turniDaRendere.reduce((acc, turno) => {
            if(!acc[turno.data]) acc[turno.data] = [];
            acc[turno.data].push(turno);
            return acc;
        }, {});
        
        const filteredDates = Object.keys(filteredTurniPerData).sort();
        
        if (filteredDates.length === 0 && currentFilter === 'miei') {
            calendar.innerHTML = '<p style="color:var(--text-muted); grid-column: 1 / -1; text-align:center; padding: 2rem;">Non sei iscritto a nessun turno al momento.</p>';
            return;
        }
        
        filteredDates.forEach(dataString => {
          const turniDelGiorno = filteredTurniPerData[dataString];
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
    } else {
        // VISTA DISPONIBILITÀ
        dateOrdinate.forEach(dataString => {
          const card = document.createElement('div');
          card.className = 'day-card';
          
          const dispGiorno = disponibilitaList.filter(d => d.data === dataString);
          const autisti = dispGiorno.filter(d => d.ruolo === 'autista').length;
          const referenti = dispGiorno.filter(d => d.ruolo === 'referente_soreu').length;
          const soccorritori = dispGiorno.filter(d => d.ruolo === 'soccorritore').length;
          const allievi = dispGiorno.filter(d => d.ruolo === 'allievo_quarto_posto').length;
          
          const myMatricola = currentUser ? String(currentUser.matricola) : '';
          const isMeCandidate = dispGiorno.some(d => String(d.matricola) === myMatricola);
          
          if (isMeCandidate) {
              card.classList.add('my-shift'); // Evidenzia la card se c'è la mia candidatura
          }
          
          let listHTML = `
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.5rem; text-align:left; line-height:1.3;">
              <div style="${autisti > 0 ? 'color:#00ffcc; font-weight:bold;' : ''}">🚑 Autisti: ${autisti}</div>
              <div style="${referenti > 0 ? 'color:#00ffcc; font-weight:bold;' : ''}">📞 Referenti: ${referenti}</div>
              <div style="${soccorritori > 0 ? 'color:#00ffcc; font-weight:bold;' : ''}">🎒 Op. DAE: ${soccorritori}</div>
              <div style="${allievi > 0 ? 'color:#00ffcc; font-weight:bold;' : ''}">🔰 Allievi: ${allievi}</div>
            </div>
          `;
          
          const formattedDate = `${dataString.split('-')[2]}/${dataString.split('-')[1]}`;
          
          card.innerHTML = `
            <strong style="font-size: 1.25rem; text-shadow: 0 0 5px rgba(255,255,255,0.2);">${formattedDate}</strong>
            <span class="badge" style="margin-top: 0.25rem; font-size: 0.65rem; background:rgba(0, 255, 204, 0.15); color:#00ffcc; border:1px solid rgba(0, 255, 204, 0.3);">DISPONIBILITÀ</span>
            ${listHTML}
          `;
          
          card.addEventListener('click', () => {
            currentSelectedDate = dataString;
            renderMicroDay(dataString);
            bottomSheet.classList.add('active');
            bsOverlay.classList.add('active');
            if (btnCloseDetails) btnCloseDetails.classList.add('active');
          });
          calendar.appendChild(card);
        });
    }
  };

  const renderMicroDay = (dataString) => {
    const dataFmt = dataString.split('-').reverse().join('/');
    bsTitle.textContent = currentView === 'ufficiale' ? `Turni del ${dataFmt}` : `Disponibilità del ${dataFmt}`;
    bsContent.innerHTML = '';

    if (currentView === 'ufficiale') {
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
    } else {
        // SCHERMATA DETTAGLI DISPONIBILITÀ
        const dispGiorno = disponibilitaList.filter(d => d.data === dataString);
        
        // 1. Lista disponibilità inserite
        const listCard = document.createElement('div');
        listCard.className = 'shift-card';
        listCard.style.padding = '1.25rem';
        
        let listHTML = `<h3 style="margin-top:0; color:var(--text-main); font-size:1.1rem;">Disponibilità Inserite</h3>`;
        if (dispGiorno.length === 0) {
            listHTML += `<p style="color:var(--text-muted); font-size:0.9rem; margin-bottom:0;">Nessun volontario si è ancora proposto per questo giorno.</p>`;
        } else {
            listHTML += `<div style="display:flex; flex-direction:column; gap:0.6rem; margin-bottom:0.5rem;">`;
            dispGiorno.forEach(d => {
                const isMe = String(d.matricola) === String(currentUser?.matricola);
                const ruoloFmt = d.ruolo.replace(/_/g, ' ').toUpperCase();
                const icon = d.ruolo === 'autista' ? '🚑' : (d.ruolo === 'referente_soreu' ? '📞' : (d.ruolo === 'soccorritore' ? '🎒' : '🔰'));
                const deleteBtn = isMe ? `<button class="btn-remove-disp" data-id="${d.id}" title="Cancella la mia disponibilità" style="background:transparent; border:none; cursor:pointer; margin-left:0.5rem; font-size:1rem; padding:0;">❌</button>` : '';
                
                listHTML += `
                    <div class="slot-row slot-prenotato" style="margin: 0; padding: 0.6rem; border-radius: 6px;">
                        <div class="slot-info">
                            <span class="slot-icon">${icon}</span>
                            <div>
                                <div style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">${ruoloFmt}</div>
                                <div style="font-weight:600; color:${isMe ? '#00f2fe' : '#fff'}; font-size:1rem;">
                                    ${isMe ? 'Tu' : formattaNomeDisplay(d.nominativo)} [${d.orario?.inizio}-${d.orario?.fine}] ${deleteBtn}
                                </div>
                            </div>
                        </div>
                        <span class="status-badge status-wait" style="background: rgba(255, 204, 0, 0.15); color: #ffcc00; border-color: rgba(255, 204, 0, 0.3);">[Pendente]</span>
                    </div>
                `;
            });
            listHTML += `</div>`;
        }
        listCard.innerHTML = listHTML;
        bsContent.appendChild(listCard);
        
        // Aggiungi event listener per pulsanti elimina
        listCard.querySelectorAll('.btn-remove-disp').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idDisp = btn.getAttribute('data-id');
                cancellaDisponibilita(idDisp);
            });
        });

        // 2. Form per proporre la propria disponibilità
        const formCard = document.createElement('div');
        formCard.className = 'shift-card';
        formCard.style.padding = '1.25rem';
        formCard.innerHTML = `
            <h3 style="margin-top:0; color:var(--text-main); font-size:1.1rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.5rem; margin-bottom:1rem;">Offri la tua disponibilità</h3>
            <div style="display:flex; flex-direction:column; gap:0.8rem;">
                <div>
                    <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:0.3rem;">Ruolo</label>
                    <select id="disp-ruolo" class="btn" style="width:100%; text-align:left; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.25); color:#fff; font-size:0.95rem;">
                        <option value="autista">🚑 Autista MSB</option>
                        <option value="referente_soreu">📞 Socc. Referente SOREU</option>
                        <option value="soccorritore">🎒 Operatore DAE</option>
                        <option value="allievo_quarto_posto">🔰 Allievo</option>
                    </select>
                </div>
                <div style="display:flex; gap:1rem;">
                    <div style="flex:1;">
                        <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:0.3rem;">Dalle ore</label>
                        <input type="time" id="disp-inizio" value="08:00" style="width:100%; box-sizing:border-box; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.25); color:#fff; padding:0.5rem; border-radius:6px; font-size:0.95rem; font-family:inherit;">
                    </div>
                    <div style="flex:1;">
                        <label style="display:block; font-size:0.8rem; color:var(--text-muted); margin-bottom:0.3rem;">Alle ore</label>
                        <input type="time" id="disp-fine" value="14:00" style="width:100%; box-sizing:border-box; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.25); color:#fff; padding:0.5rem; border-radius:6px; font-size:0.95rem; font-family:inherit;">
                    </div>
                </div>
                <button id="btn-invia-disp" class="btn" style="margin-top:0.5rem; background:#00ffcc; color:#141419; font-weight:bold; border:none; box-shadow:0 0 10px rgba(0,255,204,0.3);">🙋 Invia Disponibilità</button>
            </div>
        `;
        bsContent.appendChild(formCard);
        
        // Event listener per pulsante invia
        formCard.querySelector('#btn-invia-disp').addEventListener('click', () => {
            const ruolo = formCard.querySelector('#disp-ruolo').value;
            const inizio = formCard.querySelector('#disp-inizio').value;
            const fine = formCard.querySelector('#disp-fine').value;
            aggiungiDisponibilita(dataString, ruolo, inizio, fine);
        });
    }
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
            const btnEditHtml = (isMe || isAdmin) ? `<button class="btn-edit-time" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-inizio="${membro.inizio}" data-fine="${membro.fine}" title="Modifica Orario Fine" style="background:transparent; border:none; cursor:pointer; margin-left:0.2rem; font-size:1rem;">✏️</button>` : '';
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

        const regole = verificaIscrizione(currentUser, turno, keyRuolo);

        // --- OBIETTIVO 2: Un pulsante per ogni buco orario scoperto ---
        buchiOrario.forEach(buco => {
            const bucoLabel = `${buco.inizio}-${buco.fine}`;
            let btnStr = '';

            let riposoCheck = { idoneo: true, motivo: "" };
            const myTipoRapporto = currentUser.tipoRapporto || "Volontario";
            const isRuleActive = (myTipoRapporto === "Volontario" && configLive.controllaRiposoVolontari) || 
                                 (myTipoRapporto === "Dipendente" && configLive.controllaRiposoDipendenti);

            if (isRuleActive) {
                if (typeof validaRiposi === 'function') {
                    riposoCheck = validaRiposi(turno.data, buco.inizio, buco.fine, myShifts);
                }
            }

            if (giaNelTurno && !iAmInThisRole) {
                btnStr = '<span style="font-size:0.75rem; color:var(--neon-green)">Sei in un altro ruolo</span>';
            } else if (isAdmin && !configLive.applicaRegoleAdmin) {
                // Admin con bypass attivo → Assegna sempre, ignora regola riposo
                btnStr = `<button class="btn btn-assign-vol" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-buco-inizio="${buco.inizio}" data-buco-fine="${buco.fine}">👤 Assegna Volontario</button>`;
            } else if (isAdmin && configLive.applicaRegoleAdmin) {
                // Admin con regola applicata → mostra assegna + avviso se violazione
                const avviso = (isRuleActive && !riposoCheck.idoneo) ? ' <span style="font-size:0.65rem; color:var(--neon-red);">⚠️ Riposo</span>' : '';
                btnStr = `<button class="btn btn-assign-vol" data-turno="${turno.id}" data-ruolo="${keyRuolo}" data-buco-inizio="${buco.inizio}" data-buco-fine="${buco.fine}">👤 Assegna Volontario</button>${avviso}`;
            } else if (isKioskMode) {
                btnStr = '';
            } else if (isRuleActive && !riposoCheck.idoneo && !iAmInThisRole) {
                btnStr = `<span style="font-size:0.75rem; color:var(--neon-red); font-weight:600;" title="${riposoCheck.motivo}">⚠️ No Riposo (11h)</span>`;
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

  // --- OBIETTIVO 2: Assegnazione volontario tramite MODAL con barra di ricerca ---
  const assegnaVolontario = async (idTurno, ruolo, bucoInizio, bucoFine) => {
    const turno = turniList.find(t => t.id === idTurno);
    const selezione = await apriVolPicker(bucoInizio, bucoFine, turno, ruolo);
    if (!selezione) return; // utente ha chiuso il modal

    const { matricola, nominativo } = selezione;
    if (!confirm(`Confermi l'assegnazione di ${nominativo} (Matr. ${matricola}) per ${bucoInizio}-${bucoFine}?`)) return;

    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Assegnazione ${matricola} a ${idTurno} ruolo ${ruolo} per ${bucoInizio}-${bucoFine}`);
    isUpdating = true;

    try {
        const docRef = doc(db, "turni", idTurno);
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (!snap.exists()) throw "Turno non trovato";
            let equipaggio = snap.data().equipaggio_attuale || {};
            if (!equipaggio[ruolo] || !Array.isArray(equipaggio[ruolo])) {
                const old = equipaggio[ruolo];
                equipaggio[ruolo] = (old && typeof old === 'object') 
                    ? Object.values(old).filter(v => v && typeof v === 'object' && v.matricola) 
                    : [];
            }
            const matricolaStr = String(matricola).trim();
            const giaIscrittoInAltroRuolo = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => {
                if (r === ruolo) return false;
                const slot = equipaggio[r];
                if (!slot) return false;
                const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
                return slotArr.some(m => m && m.matricola && String(m.matricola) === matricolaStr);
            });
            if (giaIscrittoInAltroRuolo) throw "Il volontario è già assegnato a un altro ruolo in questo turno.";

            equipaggio[ruolo].push({
                matricola: String(matricola).trim(),
                nominativo: String(nominativo).trim(),
                inizio: String(bucoInizio).trim(),
                fine: String(bucoFine).trim(),
                convalidato_da_admin: false
            });
            transaction.update(docRef, { equipaggio_attuale: equipaggio });
        });
        console.log("[DEBUG_DB] CONFERMA_FIRESTORE: Assegnazione confermata da DB");
    } catch (e) {
        console.error("Errore assegnazione volontario:", e);
        alert("Errore nell'assegnazione: " + e);
    } finally {
        isUpdating = false;
        // Rendering delegato a onSnapshot per dati sempre freschi
    }
  };

  const iscriviti = async (idTurno, ruolo, bucoInizio, bucoFine) => {
    // L'utente è già identificato: auto-iscrizione diretta senza prompt
    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Auto-iscrizione a ${idTurno} ruolo ${ruolo} orario ${bucoInizio}-${bucoFine}`);
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

            // Orario pre-calcolato dal buco residuo
            const oraInizio = bucoInizio || turnoData.orario?.inizio || "08:00";
            const oraFine   = bucoFine   || turnoData.orario?.fine   || "14:00";

            const nuovoMembro = {
                matricola: String(currentUser.matricola).trim(),
                nominativo: String(`${currentUser.cognome} ${currentUser.nome}`).trim(),
                inizio: String(oraInizio).trim(),
                fine:   String(oraFine).trim(),
                convalidato_da_admin: false
            };

            // Validazione: controlla che l'utente non sia già iscritto a un altro ruolo nello stesso turno
            const matricolaStr = String(currentUser.matricola).trim();
            const giaIscrittoInAltroRuolo = ['autista', 'referente_soreu', 'soccorritore', 'allievo_quarto_posto'].some(r => {
                if (r === ruolo) return false;
                const slot = equipaggio[r];
                if (!slot) return false;
                const slotArr = Array.isArray(slot) ? slot : Object.values(slot);
                return slotArr.some(m => m && m.matricola && String(m.matricola) === matricolaStr);
            });
            if (giaIscrittoInAltroRuolo) throw "Sei già iscritto a questo turno con un altro ruolo.";

            // Validazione: controlla duplicato nello STESSO ruolo (previene double-click race)
            const giaNelloStessoRuolo = equipaggio[ruolo].some(m => String(m.matricola) === matricolaStr);
            if (giaNelloStessoRuolo) throw "Sei già iscritto a questo ruolo in questo turno.";

            console.log("[DEBUG_DB] DATA_INVIO:", nuovoMembro);
            equipaggio[ruolo].push(nuovoMembro);
            transaction.update(docRef, { equipaggio_attuale: equipaggio });
        });
        console.log("[DEBUG_DB] CONFERMA_FIRESTORE: Iscrizione confermata da DB");
    } catch (error) {
        console.error("Errore iscrizione:", error);
        alert("Errore durante l'iscrizione: " + error);
    } finally {
        isUpdating = false;
        // Rendering delegato a onSnapshot per dati sempre freschi
    }
  };

  const modificaOrarioFine = async (idTurno, ruolo, inizioSelezionato, orarioFineAttuale) => {
    const nuovoOrarioFine = prompt(`Modifica l'orario di fine per questo blocco (Inizio: ${inizioSelezionato}):`, orarioFineAttuale);
    if (!nuovoOrarioFine) return;

    const nuovaFineClean = String(nuovoOrarioFine).trim();
    if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(nuovaFineClean)) {
        alert("Formato non valido! Usa il formato HH:MM (es. 19:00)");
        return;
    }

    if (nuovaFineClean === String(orarioFineAttuale).trim()) {
        console.log("[IDEMPOTENCY] Nessuna modifica all'orario rilevata. Scrittura annullata.");
        return;
    }

    console.log(`[DEBUG_DB] INIZIO_OPERAZIONE: Modifica orario fine a ${idTurno} ruolo ${ruolo} per ${nuovaFineClean} (Inizio: ${inizioSelezionato})`);
    isUpdating = true;

    try {
        const docRef = doc(db, "turni", String(idTurno).trim());
        await runTransaction(db, async (transaction) => {
            const snap = await transaction.get(docRef);
            if (!snap.exists()) throw "Turno non trovato";
            
            const data = snap.data();
            let equipaggio = data.equipaggio_attuale || {};
            
            if (equipaggio[ruolo] && !Array.isArray(equipaggio[ruolo])) {
                const vals = Object.values(equipaggio[ruolo]).filter(v => v && typeof v === 'object' && v.matricola);
                equipaggio[ruolo] = vals;
            }
            let changed = false;
            if (equipaggio[ruolo]) {
                const isAdmin = currentUser && (currentUser.ruolo === 'admin' || currentUser.ruolo === 'superadmin' || currentUser.is_admin === true);
                equipaggio[ruolo] = equipaggio[ruolo].map(m => {
                    const matchAdmin = isAdmin && String(m.inizio).trim() === String(inizioSelezionato).trim();
                    const matchSelf = !isAdmin && String(m.matricola) === String(currentUser.matricola) && String(m.inizio).trim() === String(inizioSelezionato).trim();
                    if (matchAdmin || matchSelf) {
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
        console.log("[DEBUG_DB] CONFERMA_FIRESTORE: Modifica orario confermata da DB");
    } catch (e) {
        if (e === "NESSUNA_MODIFICA") {
            console.log("[IDEMPOTENCY] Transazione abortita: valori identici.");
        } else {
            console.error("Errore durante la modifica dell'orario:", e);
            alert("Errore nell'aggiornamento: " + e);
        }
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
            startDisponibilitaSnapshot();
            return;
        }
        const noRedirect = new URLSearchParams(window.location.search).get('no_redirect') === 'true';
        if (matricola.toLowerCase() === 'agogio') {
           if (!noRedirect) {
               window.location.href = "vista_responsabile.html";
               return;
           }
           // Profilo virtuale superadmin per evitare redirect in modalità split-screen
           currentUser = { matricola: '034', nome: 'Giorgio', cognome: 'Agostini', is_admin: true, superadmin: true };
           let adminBtnHTML = `<button id="btn-goto-admin" class="btn" style="margin-left:1rem; padding:0.3rem 0.6rem; font-size:0.8rem; border-color:var(--neon-green); color:var(--neon-green); background:rgba(57,255,20,0.1);">Accedi a Programmazione</button>`;
           let notifyBtnHTML = "";
           userInfoDiv.innerHTML = `Profilo: SUPERADMIN ${adminBtnHTML} ${notifyBtnHTML} <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
           document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
           document.getElementById('btn-goto-admin').addEventListener('click', () => { window.location.href = "vista_responsabile.html"; });
           
           startTurniSnapshot();
           startDisponibilitaSnapshot();
           return;
        }
        
        // Avvia il listener delle configurazioni (dopo auth confermata)
        if (!configUnsubscribe) {
            configUnsubscribe = onSnapshot(doc(db, "impostazioni", "regole_riposo"), (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    configLive.controllaRiposoVolontari = !!data.controllaRiposoVolontari;
                    configLive.controllaRiposoDipendenti = !!data.controllaRiposoDipendenti;
                    configLive.applicaRegoleAdmin = !!data.applicaRegoleAdmin;
                }
            });
        }

        const snap = await getDoc(doc(db, "utenti", matricola));
        if (snap.exists()) {
          currentUser = snap.data();
          let adminBtnHTML = currentUser.is_admin ? `<button id="btn-goto-admin" class="btn" style="margin-left:1rem; padding:0.3rem 0.6rem; font-size:0.8rem; border-color:var(--neon-green); color:var(--neon-green); background:rgba(57,255,20,0.1);">Accedi a Programmazione</button>` : "";
          let notifyBtnHTML = "";
          if (window.Notification && Notification.permission !== "granted") {
              notifyBtnHTML = `<button id="btn-enable-notifications" class="btn" style="margin-left:1rem; padding:0.3rem 0.6rem; font-size:0.8rem; border-color:var(--neon-orange); color:var(--neon-orange); background:rgba(255,153,0,0.1); border-style:dashed;">🔔 Attiva Notifiche</button>`;
          }

          userInfoDiv.innerHTML = `Profilo: ${formattaNominativoUtente(currentUser)} ${adminBtnHTML} ${notifyBtnHTML} <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
          document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

          if (document.getElementById('btn-enable-notifications')) {
              document.getElementById('btn-enable-notifications').addEventListener('click', async () => {
                  const btn = document.getElementById('btn-enable-notifications');
                  btn.disabled = true;
                  btn.textContent = "Attivazione...";
                  try {
                      await window.AppMessaging.requestNotificationPermissions(currentUser.matricola);
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
          if (currentUser.is_admin) {
              document.getElementById('btn-goto-admin').addEventListener('click', () => { window.location.href = "vista_responsabile.html"; });
          }
          startTurniSnapshot();
          startDisponibilitaSnapshot();
          if (typeof startVolunteerMessagingListener === 'function') {
              startVolunteerMessagingListener(currentUser.matricola);
          }
          
          // Richiedi permessi e registra token per le notifiche push del volontario
          if (window.AppMessaging && window.AppMessaging.requestNotificationPermissions) {
              window.AppMessaging.requestNotificationPermissions(currentUser.matricola);
              window.AppMessaging.listenInForeground();
          } else {
              const checkMsg = setInterval(() => {
                  if (window.AppMessaging && window.AppMessaging.requestNotificationPermissions) {
                      window.AppMessaging.requestNotificationPermissions(currentUser.matricola);
                      window.AppMessaging.listenInForeground();
                      clearInterval(checkMsg);
                  }
              }, 500);
              setTimeout(() => clearInterval(checkMsg), 10000);
          }
        } else {
          alert("Profilo volontario non trovato nel database.");
          signOut(auth);
        }
      } else {
        const noRedirect = new URLSearchParams(window.location.search).get('no_redirect') === 'true';
        window.location.href = "index.html" + (noRedirect ? "?no_redirect=true" : "");
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

  function startDisponibilitaSnapshot() {
      if (activeUnsubscribeDisponibilita) activeUnsubscribeDisponibilita();
      const q = query(collection(db, "disponibilita")); 
      
      activeUnsubscribeDisponibilita = onSnapshot(q, (snapshot) => {
        disponibilitaList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log("[DEBUG_DB] onSnapshot disponibilità ricevuto dal server. Aggiorno la vista.");
        
        renderMacroCalendar();
        if (bottomSheet.classList.contains('active') && currentSelectedDate) {
          renderMicroDay(currentSelectedDate);
        }
      });
  }

  window.startVolunteerMessagingListener = function(volunteerMatricola) {
      const unreadCountSpan = document.getElementById("vol-msg-unread-count");
      const listContainer = document.getElementById("vol-messaging-list-container");

      if (!volunteerMatricola) {
          console.warn("[MESSAGING_UI] Impossibile avviare il listener: matricola utente non trovata.");
          return;
      }

      if (window.AppMessaging && window.AppMessaging.listenForMessages) {
          window.AppMessaging.listenForMessages(String(volunteerMatricola).trim(), (messaggi) => {
              const unreadCount = messaggi.filter(m => !m.letto).length;
              
              if (unreadCount > 0) {
                  unreadCountSpan.textContent = unreadCount;
                  unreadCountSpan.style.display = "block";
              } else {
                  unreadCountSpan.style.display = "none";
              }

              if (messaggi.length === 0) {
                  listContainer.innerHTML = `<p style="color: #888; text-align: center; margin-top: 50px;">Nessun messaggio per te.</p>`;
                  return;
              }

              listContainer.innerHTML = messaggi.map(msg => {
                  const borderNeon = msg.letto ? 'rgba(255,255,255,0.05)' : '1px solid #ff0055';
                  const bgState = msg.letto ? 'rgba(255,255,255,0.02)' : 'rgba(255, 0, 85, 0.05)';
                  const testoSafe = document.createElement('span');
                  testoSafe.textContent = msg.testo || '';
                  const testoEscaped = testoSafe.innerHTML;
                  const mittenteSafe = document.createElement('span');
                  mittenteSafe.textContent = msg.mittente_matricola || '';
                  const mittenteEscaped = mittenteSafe.innerHTML;
                  
                  return `
                      <div class="msg-card" style="background: ${bgState}; border: 1px solid ${borderNeon}; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
                          <div style="font-size: 11px; color: #888; margin-bottom: 5px; display: flex; justify-content: space-between;">
                              <span>Da: Direzione (Matr. ${mittenteEscaped})</span>
                              <span>${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                          </div>
                          <div style="font-size: 13px; color: #e0e0e0; line-height: 1.4; word-break: break-word;">${testoEscaped}</div>
                          ${!msg.letto ? `<button class="vol-mark-read-btn" data-id="${msg.id}" style="margin-top: 8px; background: transparent; border: 1px solid #00ffcc; color: #00ffcc; border-radius: 4px; font-size: 10px; padding: 2px 6px; cursor: pointer;">Segna come letto</button>` : ''}
                      </div>
                  `;
              }).join('');

              // Bind Mark As Read for volunteer layout
              listContainer.querySelectorAll(".vol-mark-read-btn").forEach(btn => {
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
  };

  const badgeContainer = document.getElementById("volunteer-messaging-badge-container");
  const msgPanel = document.getElementById("volunteer-messaging-panel");
  const closePanelBtn = document.getElementById("close-vol-messaging-panel");

  if (badgeContainer && msgPanel) {
      badgeContainer.addEventListener("click", () => {
          msgPanel.style.display = msgPanel.style.display === "none" ? "block" : "none";
      });
  }
  if (closePanelBtn && msgPanel) {
      closePanelBtn.addEventListener("click", () => { msgPanel.style.display = "none"; });
  }

  // =====================================================
  //  GESTIONE SCRITTURA DISPONIBILITÀ (FIRESTORE)
  // =====================================================
  const aggiungiDisponibilita = async (dataString, ruolo, inizio, fine) => {
      if (isUpdating) return;
      
      if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(inizio) || !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(fine)) {
          alert("Inserisci l'orario nel formato HH:MM (es. 08:00)");
          return;
      }
      
      const minI = timeToMinutes(inizio);
      const minF = timeToMinutes(fine);
      if (minF <= minI) {
          alert("L'orario di fine deve essere successivo all'orario di inizio.");
          return;
      }

      console.log(`[DEBUG_DB] Invio disponibilità per ${dataString} ruolo ${ruolo} orario ${inizio}-${fine}`);
      isUpdating = true;
      try {
          const nuovaDisp = {
              matricola: String(currentUser.matricola).trim(),
              nominativo: String(`${currentUser.cognome} ${currentUser.nome}`).trim(),
              data: String(dataString).trim(),
              ruolo: String(ruolo).trim(),
              orario: {
                  inizio: String(inizio).trim(),
                  fine: String(fine).trim()
              },
              stato: "IN_ATTESA",
              creato_il: new Date().toISOString()
          };
          await addDoc(collection(db, "disponibilita"), nuovaDisp);
          console.log("[DEBUG_DB] Disponibilità salvata con successo");
      } catch (err) {
          console.error("Errore salvataggio disponibilità:", err);
          alert("Errore durante l'invio della disponibilità: " + err);
      } finally {
          isUpdating = false;
      }
  };

  const cancellaDisponibilita = async (idDisp) => {
      if (isUpdating) return;
      if (!confirm("Vuoi davvero cancellare questa disponibilità?")) return;
      
      isUpdating = true;
      try {
          await deleteDoc(doc(db, "disponibilita", idDisp));
          console.log("[DEBUG_DB] Disponibilità cancellata con successo");
      } catch (err) {
          console.error("Errore cancellazione disponibilità:", err);
          alert("Errore durante la cancellazione: " + err);
      } finally {
          isUpdating = false;
      }
  };

});