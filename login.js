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
  // 1. Caricamento versione
  try {
    const res = await fetch('./versione_app.json');
    const data = await res.json();
    document.getElementById('version-text').textContent = `Ver. ${data.versione}`;
  } catch (e) {
    document.getElementById('version-text').textContent = `Ver. Sconosciuta`;
  }

  const btnLogin = document.getElementById('btn-login');
  const errorMsg = document.getElementById('login-error');
  
  const modal = document.getElementById('pw-modal');
  const btnSavePw = document.getElementById('btn-save-pw');
  const pwError = document.getElementById('pw-error');

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

    // Intercettazione A MONTE dell'autenticazione per l'account speciale AgoGio
    if (matricola.toLowerCase() === 'agogio') {
       if (password === '950477') {
         localStorage.setItem('superadmin_override', 'true');
         window.location.href = "vista_responsabile.html";
       } else {
         errorMsg.textContent = "Credenziali Superadmin non valide.";
         btnLogin.disabled = false;
       }
       return;
    }

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
    
    // Se è loggato in altro modo, o se AgoGio non ha usato il token (caso anomalo ma gestito)
    if (matricola.toLowerCase() === 'agogio') {
      localStorage.setItem('superadmin_override', 'true');
      window.location.href = "vista_responsabile.html";
      return;
    }

    try {
      const docSnap = await getDoc(doc(db, "utenti", matricola));
      if (docSnap.exists()) {
        // Come stabilito: TUTTI accedono alla vista volontario.
        // Gli admin troveranno lì il pulsante "Accedi a Programmazione"
        window.location.href = "vista_volontario.html";
      } else {
        errorMsg.textContent = "Utente non trovato nel database.";
      }
    } catch(e) {
      console.error("Errore lettura ruoli Firestore:", e.code, e.message);
      errorMsg.textContent = "Errore lettura ruoli.";
    }
  }
});
