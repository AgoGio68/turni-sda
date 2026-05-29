/**
 * Modulo di utility per la formattazione e ordinamento globale degli utenti.
 */

export function formattaNominativoUtente(utente) {
    if (!utente || (!utente.cognome && !utente.nome && !utente.matricola)) {
        if (utente && utente.nominativo) return utente.nominativo;
        return "Utente Sconosciuto";
    }

    const cognome = (utente.cognome || "").trim();
    const nome = (utente.nome || "").trim();
    const matricola = (utente.matricola || "").trim();

    if (!cognome && !nome && utente.nominativo) {
        return `${utente.nominativo} - ${matricola}`;
    }

    return `${cognome}, ${nome} - ${matricola}`;
}

export function ordinaUtentiAlfabetico(utentiList) {
    return utentiList.sort((a, b) => {
        const cognomeA = (a.cognome || "").trim();
        const cognomeB = (b.cognome || "").trim();
        const nomeA = (a.nome || "").trim();
        const nomeB = (b.nome || "").trim();

        const diffCognome = cognomeA.localeCompare(cognomeB, 'it', { sensitivity: 'base' });
        
        if (diffCognome === 0) {
            return nomeA.localeCompare(nomeB, 'it', { sensitivity: 'base' });
        }
        
        return diffCognome;
    });
}
