import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";

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

async function createSuperAdmin() {
    console.log("Generazione Superadmin 'AgoGio'...");
    try {
        await createUserWithEmailAndPassword(auth, "agogio@turni-sda.local", "950477");
        console.log("✅ Superadmin creato con successo in Firebase Auth!");
    } catch(e) {
        if(e.code === 'auth/email-already-in-use') {
            console.log("ℹ Il Superadmin 'AgoGio' esiste già.");
        } else {
            console.error("❌ Errore durante la creazione:", e);
        }
    }
    process.exit(0);
}

createSuperAdmin();
