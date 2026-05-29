/**
 * Modulo di utility per la formattazione e ordinamento globale degli utenti.
 */

export function formattaNomeDisplay(nominativo) {
    if (!nominativo) return "Sconosciuto";
    // Dividi per trattino (con o senza spazi) e prendi la prima parte
    let display = nominativo.split(/\s*-\s*/)[0];
    // Rimuovi la virgola e eventuali doppi spazi
    display = display.replace(/,\s*/g, ' ').trim();
    // Pulisci spazi doppi se presenti
    display = display.replace(/\s{2,}/g, ' ');
    return display;
}

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
    const parseName = (u) => {
        if (u.cognome && u.nome) {
            return { c: (u.cognome || "").trim().toLowerCase(), n: (u.nome || "").trim().toLowerCase() };
        }
        let raw = u.nominativo || "";
        raw = raw.split('-')[0].trim(); // rimuovi matricola se presente
        
        let c = "";
        let n = "";
        
        if (raw.includes(',')) {
            const parts = raw.split(',');
            c = parts[0].trim().toLowerCase();
            n = (parts[1] || "").trim().toLowerCase();
        } else {
            const parts = raw.split(' ');
            if (parts.length > 1) {
                c = parts[0].trim().toLowerCase();
                n = parts.slice(1).join(' ').trim().toLowerCase();
            } else {
                c = raw.toLowerCase();
            }
        }
        return { c, n };
    };

    return utentiList.sort((a, b) => {
        const pA = parseName(a);
        const pB = parseName(b);

        const diffCognome = pA.c.localeCompare(pB.c, 'it', { sensitivity: 'base' });
        if (diffCognome === 0) {
            return pA.n.localeCompare(pB.n, 'it', { sensitivity: 'base' });
        }
        return diffCognome;
    });
}
