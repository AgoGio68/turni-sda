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
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, query, onSnapshot, doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { verificaIscrizione } from './regole_iscrizione.js';

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

document.addEventListener('DOMContentLoaded', () => {
  const userInfoDiv = document.getElementById('user-info');
  
  const isSuperAdminOverride = localStorage.getItem('superadmin_override') === 'true';
  if (isSuperAdminOverride) {
      window.location.href = "vista_responsabile.html";
      return;
  }

  onAuthStateChanged(auth, async (user) => {
    try {
      if (user) {
        const matricola = user.email.split('@')[0];
        
        // Se AgoGio finisce qui per sbaglio, rimandalo alla vista_responsabile
        if (matricola.toLowerCase() === 'agogio') {
           localStorage.setItem('superadmin_override', 'true');
           window.location.href = "vista_responsabile.html";
           return;
        }

        const snap = await getDoc(doc(db, "utenti", matricola));
        if (snap.exists()) {
          currentUser = snap.data();
          userInfoDiv.innerHTML = `Profilo: ${currentUser.nome} ${currentUser.cognome} (${currentUser.matricola}) <a href="#" id="logout-btn" style="margin-left:1rem; color:var(--neon-orange); font-size:0.8rem;">Esci</a>`;
          document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
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

      const renderMacroCalendar = () => {
        calendar.innerHTML = '';
        const turniPerData = turniList.reduce((acc, turno) => {
            if(!acc[turno.data]) acc[turno.data] = [];
            acc[turno.data].push(turno);
            return acc;
        }, {});

        const dateOrdinate = Object.keys(turniPerData).sort();

        dateOrdinate.forEach(dataString => {
          const turniDelGiorno = turniPerData[dataString];
          const card = document.createElement('div');
          card.className = 'day-card';
          card.style.minHeight = '140px';
          
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

          card.innerHTML = `
            <strong style="font-size: 1.25rem; text-shadow: 0 0 5px rgba(255,255,255,0.2);">${formattedDate}</strong>
            <span class="badge ${badgeClass}" style="margin-top: 0.25rem; font-size: 0.65rem;">${statoDay}</span>
            
            <div class="micro-bars">
                <span class="micro-bar-label">Mattina</span>
                <div class="micro-bar ${fasce.M || ''}"></div>
                <span class="micro-bar-label">Pomeriggio</span>
                <div class="micro-bar ${fasce.P || ''}"></div>
                <span class="micro-bar-label">Notte</span>
                <div class="micro-bar ${fasce.N || ''}"></div>
            </div>
          `;

          card.addEventListener('click', () => {
            currentSelectedDate = dataString;
            renderMicroDay(dataString);
            bottomSheet.classList.add('active');
            bsOverlay.classList.add('active');
          });

          calendar.appendChild(card);
        });
      };

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
                        <strong style="color:var(--text-main); font-size:1.1rem; letter-spacing: 0.5px;">${(turno.tipo_servizio||'').replace('_', ' ')}</strong><br>
                        <span style="color:var(--text-muted); font-size:0.9rem;">🕒 ${turno.orario?.inizio} - ${turno.orario?.fine}</span>
                    </div>
                    <span class="badge ${turno.stato_turno === 'APERTO' ? 'incompleto' : (turno.stato_turno === 'CRITICO' ? 'critico' : 'convalidato')}">${turno.stato_turno}</span>
                </div>
                <div class="shift-slots">
                    ${renderSlotRow(turno, 'autista', 'AUTISTA', eq.autista, req.autista_richiesto, '🚑', turniDelGiorno)}
                    ${renderSlotRow(turno, 'referente_soreu', 'SOCC. REFERENTE SOREU', eq.referente_soreu, req.referente_richiesto, '📞', turniDelGiorno)}
                    ${renderSlotRow(turno, 'soccorritore', 'SOCCORRITORE', eq.soccorritore, req.soccorritore_richiesto, '🎒', turniDelGiorno)}
                    ${renderSlotRow(turno, 'allievo_quarto_posto', 'ALLIEVO 4° POSTO', eq.allievo_quarto_posto, req.allievo_consentito, '🔰', turniDelGiorno)}
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

      const renderSlotRow = (turno, keyRuolo, labelRuolo, membro, richiesto, icon, tuttiITurniDelGiorno) => {
        if(!richiesto && keyRuolo !== 'allievo_quarto_posto') return ''; 
        if(keyRuolo === 'allievo_quarto_posto' && !richiesto) return ''; 

        if (membro?.matricola) {
            const isMe = membro.matricola === currentUser.matricola;
            const nomeStampato = isMe ? `<span style="color:var(--neon-green)">Tu (${membro.nominativo})</span>` : membro.nominativo;
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
            const giaNelTurno = (eqCompleto.autista?.matricola === currentUser.matricola || 
                                 eqCompleto.referente_soreu?.matricola === currentUser.matricola ||
                                 eqCompleto.soccorritore?.matricola === currentUser.matricola ||
                                 eqCompleto.allievo_quarto_posto?.matricola === currentUser.matricola);

            let conflittoOrario = false;
            tuttiITurniDelGiorno.forEach(t => {
                if (t.id !== turno.id) {
                    const e = t.equipaggio_attuale || {};
                    const presenteInT = (e.autista?.matricola === currentUser.matricola || 
                                         e.referente_soreu?.matricola === currentUser.matricola ||
                                         e.soccorritore?.matricola === currentUser.matricola ||
                                         e.allievo_quarto_posto?.matricola === currentUser.matricola);
                    if (presenteInT) {
                        const inizioA = parseInt(turno.orario?.inizio.replace(':', ''));
                        const fineA = parseInt(turno.orario?.fine.replace(':', ''));
                        const inizioB = parseInt(t.orario?.inizio.replace(':', ''));
                        const fineB = parseInt(t.orario?.fine.replace(':', ''));
                        
                        if(inizioA < fineB && fineA > inizioB) {
                            conflittoOrario = true;
                        }
                    }
                }
            });

            const regole = verificaIscrizione(currentUser, turno, keyRuolo);
            let btnStr = '';

            if (giaNelTurno) {
                btnStr = '<span style="font-size:0.75rem; color:var(--neon-green)">Sei in questo equipaggio</span>';
            } else if (conflittoOrario) {
                btnStr = '<span style="font-size:0.75rem; color:var(--neon-orange); text-align:right; max-width: 140px; line-height:1.2;">Sei già impegnato in un altro servizio in queste ore</span>';
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

      const iscriviti = async (idTurno, ruolo) => {
        const turnoTarget = turniList.find(t => t.id === idTurno);
        if (!turnoTarget) return;

        try {
            const docRef = doc(db, "turni", idTurno);
            const eq = { ...turnoTarget.equipaggio_attuale };
            
            const nuovoMembro = {
                matricola: currentUser.matricola,
                nominativo: `${currentUser.nome} ${currentUser.cognome}`,
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
                azione: `Iscrizione autonoma come ${ruolo.replace('_', ' ')}`,
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
