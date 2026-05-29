import { initializeApp } from "firebase/app";
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
    const matricola = document.getElementById('matricola').value.trim();
    const password = document.getElementById('password').value;

    if (!matricola || !password) {
      errorMsg.textContent = "Inserisci matricola e password.";
      return;
    }

    errorMsg.textContent = "Autenticazione in corso...";
    btnLogin.disabled = true;

    // Se admin supremo AgoGio bypassa l'email fittizia .local
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
      console.error(error);
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
      console.error(err);
      pwError.textContent = "Errore durante il cambio password.";
      btnSavePw.disabled = false;
    }
  });

  async function checkRoleAndRedirect(user) {
    const matricola = user.email.split('@')[0];
    try {
      const docSnap = await getDoc(doc(db, "utenti", matricola));
      if (docSnap.exists()) {
        const userData = docSnap.data();
        if (userData.is_admin) {
          window.location.href = "vista_responsabile.html";
        } else {
          window.location.href = "vista_volontario.html";
        }
      } else {
        // Se è l'admin segreto creato manualmenete
        if (matricola === 'agogio') {
          window.location.href = "vista_responsabile.html";
        } else {
          errorMsg.textContent = "Utente non trovato nel database.";
        }
      }
    } catch(e) {
        console.error(e);
        errorMsg.textContent = "Errore lettura ruoli.";
    }
  }
});
