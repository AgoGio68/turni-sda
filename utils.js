/**
 * Modulo di utility per la formattazione e ordinamento globale degli utenti.
 */

export function formattaNomeDisplay(nominativo) {
    if (!nominativo) return "Sconosciuto";
    try {
        let display = String(nominativo).split(/\s*-\s*/)[0];
        display = display.replace(/,\s*/g, ' ').trim();
        display = display.replace(/\s{2,}/g, ' ');
        return display;
    } catch(e) {
        return String(nominativo);
    }
}

export function formattaNominativoUtente(utente) {
    try {
        if (!utente || (!utente.cognome && !utente.nome && !utente.matricola)) {
            if (utente && utente.nominativo) return String(utente.nominativo);
            return "Utente Sconosciuto";
        }

        const cognome = String(utente.cognome || "").trim();
        const nome = String(utente.nome || "").trim();
        const matricola = String(utente.matricola || "").trim();

        if (!cognome && !nome && utente.nominativo) {
            return `${String(utente.nominativo)} - ${matricola}`;
        }

        return `${cognome}, ${nome} - ${matricola}`;
    } catch(e) {
        return "Utente Sconosciuto";
    }
}

export function ordinaUtentiAlfabetico(utentiList) {
    const parseName = (u) => {
        try {
            if (u.cognome && u.nome) {
                return { c: String(u.cognome).trim().toLowerCase(), n: String(u.nome).trim().toLowerCase() };
            }
            let raw = String(u.nominativo || "");
            raw = raw.split('-')[0].trim();
            
            let c = "";
            let n = "";
            
            if (raw.includes(',')) {
                const parts = raw.split(',');
                c = parts[0].trim().toLowerCase();
                n = String(parts[1] || "").trim().toLowerCase();
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
        } catch (e) {
            return { c: "", n: "" };
        }
    };

    return utentiList.sort((a, b) => {
        try {
            const pA = parseName(a);
            const pB = parseName(b);

            const diffCognome = pA.c.localeCompare(pB.c, 'it', { sensitivity: 'base' });
            if (diffCognome === 0) {
                return pA.n.localeCompare(pB.n, 'it', { sensitivity: 'base' });
            }
            return diffCognome;
        } catch (e) {
            return 0;
        }
    });
}
