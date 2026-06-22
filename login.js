/*
================================================================================================
CONFIGURAZIONI DA ATTIVARE MANUALMENTE SULLA CONSOLE FIREBASE (BLOCCANTI PER IL LOGIN)
================================================================================================
1. Authentication: Abilitare il provider "Email/Password" (senza link email).
2. Firestore Database: Creare una collezione "utenti".
3. Firestore Rules:
   - match /utenti/{matricola} { allow read: if request.auth != null; }
   - match /turni/{turno} { allow read, write: if request.auth != null; }
4. Assicurarsi che l'utente 'agogio@turni-sda.local' sia creato a mano in Firebase Auth.
================================================================================================
*/
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, updatePassword } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

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

document.addEventListener('DOMContentLoaded', async () => {
  // Rilevamento iOS e PWA Standalone per visualizzazione Banner di installazione
  const isIOS = /iPad|iPhone|iPod/.test(navigator.platform) || 
                (navigator.userAgent.includes("Mac") && "ontouchend" in document);
  const isStandalone = window.navigator.standalone === true || 
                       window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && !isStandalone) {
    const pwaBanner = document.getElementById('ios-pwa-banner');
    if (pwaBanner) {
      pwaBanner.style.display = 'block';
    }
  }

  const btnLogin = document.getElementById('btn-login');
  const errorMsg = document.getElementById('login-error');

  // =====================================================
  //  MAGIC LINK KIOSK: Intercettazione ?kiosk=TOKEN
  // =====================================================
  const urlParams = new URLSearchParams(window.location.search);
  const kioskToken = urlParams.get('kiosk');

  if (kioskToken) {
      errorMsg.textContent = "🖥️ Accesso Kiosk in corso...";
      btnLogin.disabled = true;

      try {
          // 1. Autenticazione con account kiosk dedicato
          await signInWithEmailAndPassword(auth, 'kiosk@turni-sda.local', 'kiosk2026');

          // 2. Verifica token contro il database
          const kioskDoc = await getDoc(doc(db, "utenti", "kiosk"));

          if (kioskDoc.exists() && kioskDoc.data().kiosk_token === kioskToken) {
              // 3. Token valido → Accesso diretto in modalità TV
              window.location.href = "vista_volontario.html?mode=kiosk";
          } else {
              // Token non valido
              await auth.signOut();
              errorMsg.textContent = "Token Kiosk non valido.";
              btnLogin.disabled = false;
          }
      } catch (e) {
          console.error("Errore accesso Kiosk:", e.code, e.message);
          errorMsg.textContent = "Errore accesso Kiosk.";
          btnLogin.disabled = false;
      }
      return; // Blocca il flusso normale del login
  }

  const modal = document.getElementById('pw-modal');
  const btnSavePw = document.getElementById('btn-save-pw');
  const pwError = document.getElementById('pw-error');

  // Gestione Guida Operativa
  const guideModal = document.getElementById('guide-modal');
  const btnOpenGuide = document.getElementById('btn-open-guide');
  const btnCloseGuide = document.getElementById('btn-close-guide');
  
  if (btnOpenGuide && guideModal) {
    btnOpenGuide.addEventListener('click', () => {
      guideModal.classList.add('active');
    });
  }
  if (btnCloseGuide && guideModal) {
    btnCloseGuide.addEventListener('click', () => {
      guideModal.classList.remove('active');
    });
  }

  btnLogin.addEventListener('click', async () => {
    const rawMatricola = document.getElementById('matricola').value;
    const password = document.getElementById('password').value.trim();

    if (!rawMatricola || !password) {
      errorMsg.textContent = "Inserisci matricola e password.";
      return;
    }

    // 1. Trim dell'input e normalizzazione (es. 34 -> 034)
    let matricola = rawMatricola.trim();
    if (!isNaN(matricola) && matricola !== '' && matricola.length < 3) {
      matricola = matricola.padStart(3, '0');
    }

    errorMsg.textContent = "Autenticazione in corso...";
    btnLogin.disabled = true;

    // 2. Costruzione e-mail
    const email = matricola.toLowerCase() === 'agogio' ? 'agogio@turni-sda.local' : `${matricola}@turni-sda.local`;

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      if (password === "soccorso2026") {
        errorMsg.textContent = "";
        modal.classList.add('active');
      } else {
        await checkRoleAndRedirect(userCredential.user);
      }
    } catch (error) {
      console.error("Errore di Login:", error.code, error.message);
      errorMsg.textContent = "Credenziali non valide.";
      btnLogin.disabled = false;
    }
  });

  btnSavePw.addEventListener('click', async () => {
    const newPw = document.getElementById('new-password').value;
    if (newPw.length < 6) {
      pwError.textContent = "La password deve contenere almeno 6 caratteri.";
      return;
    }

    btnSavePw.disabled = true;
    pwError.textContent = "Aggiornamento in corso...";

    try {
      const user = auth.currentUser;
      await updatePassword(user, newPw);
      pwError.style.color = "var(--neon-green)";
      pwError.textContent = "Password aggiornata! Reindirizzamento...";
      
      setTimeout(() => {
        checkRoleAndRedirect(user);
      }, 1000);
    } catch (err) {
      console.error("Errore durante il cambio password:", err.code, err.message);
      pwError.textContent = "Errore durante il cambio password.";
      btnSavePw.disabled = false;
    }
  });

  async function checkRoleAndRedirect(user) {
    const matricola = user.email.split('@')[0];
    const noRedirect = new URLSearchParams(window.location.search).get('no_redirect') === 'true';
    
    if (matricola.toLowerCase() === 'agogio') {
      localStorage.setItem('superadmin_override', 'true');
      if (noRedirect) {
        window.location.href = "vista_volontario.html?no_redirect=true";
      } else {
        window.location.href = "vista_responsabile.html";
      }
      return;
    }

    try {
      const docSnap = await getDoc(doc(db, "utenti", matricola));
      if (docSnap.exists()) {
        if (noRedirect) {
          window.location.href = "vista_volontario.html?no_redirect=true";
        } else {
          window.location.href = "vista_volontario.html";
        }
      } else {
        errorMsg.textContent = "Utente non trovato nel database.";
      }
    } catch(e) {
      console.error("Errore lettura ruoli Firestore:", e.code, e.message);
      errorMsg.textContent = "Errore lettura ruoli.";
    }
  }
});
