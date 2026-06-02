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

export function sanificaTurno(turno) {
    if (!turno) return turno;
    
    const eq = turno.equipaggio_attuale || {};
    
    const sanificaSlot = (slot, inizioTurno, fineTurno) => {
        if (!slot) return [];
        if (Array.isArray(slot)) {
            return slot.filter(s => s && typeof s === 'object' && s.matricola).map(s => ({
                matricola: s.matricola,
                nominativo: s.nominativo || null,
                convalidato_da_admin: !!s.convalidato_da_admin,
                inizio: s.inizio || inizioTurno,
                fine: s.fine || fineTurno,
                is_dipendente: !!s.is_dipendente
            }));
        }
        if (typeof slot === 'object') {
            if (slot.matricola) {
                return [{
                    matricola: slot.matricola,
                    nominativo: slot.nominativo || null,
                    convalidato_da_admin: !!slot.convalidato_da_admin,
                    inizio: slot.inizio || inizioTurno,
                    fine: slot.fine || fineTurno,
                    is_dipendente: !!slot.is_dipendente
                }];
            } else {
                const values = Object.values(slot).filter(v => v && typeof v === 'object' && v.matricola);
                if (values.length > 0) {
                    return values.map(s => ({
                        matricola: s.matricola,
                        nominativo: s.nominativo || null,
                        convalidato_da_admin: !!s.convalidato_da_admin,
                        inizio: s.inizio || inizioTurno,
                        fine: s.fine || fineTurno,
                        is_dipendente: !!s.is_dipendente
                    }));
                }
                return []; // Empty old format
            }
        }
        return [];
    };
    
    const inizio = turno.orario?.inizio || "00:00";
    const fine = turno.orario?.fine || "00:00";

    turno.equipaggio_attuale = {
        ...eq,
        autista: sanificaSlot(eq.autista, inizio, fine),
        referente_soreu: sanificaSlot(eq.referente_soreu, inizio, fine),
        soccorritore: sanificaSlot(eq.soccorritore, inizio, fine),
        allievo_quarto_posto: sanificaSlot(eq.allievo_quarto_posto, inizio, fine)
    };
    
    return turno;
}

export function timeToMinutes(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

export function calcolaCoperturaRuolo(assegnazioni, inizioTurno, fineTurno) {
    if (!assegnazioni || assegnazioni.length === 0) return { isFull: false, overlaps: false };
    
    let startMin = timeToMinutes(inizioTurno);
    let endMin = timeToMinutes(fineTurno);
    if (endMin <= startMin) endMin += 24 * 60; // notte
    
    const intervals = assegnazioni.map(a => {
        let s = timeToMinutes(a.inizio);
        let e = timeToMinutes(a.fine);
        // Normalize for night shifts
        if (s < 12 * 60 && startMin > 12 * 60) s += 24 * 60;
        if (e <= s) e += 24 * 60;
        return { start: s, end: e, data: a };
    }).sort((a, b) => a.start - b.start);

    let currentEnd = startMin;
    let isFull = true;
    let overlaps = false;

    for (const inv of intervals) {
        if (inv.start < currentEnd) overlaps = true;
        if (inv.start > currentEnd) isFull = false;
        currentEnd = Math.max(currentEnd, inv.end);
    }
    
    if (currentEnd < endMin) isFull = false;
    
    return { isFull, overlaps };
}

export function calcolaBuchiRuolo(assegnazioni, inizioTurno, fineTurno) {
    let startMin = timeToMinutes(inizioTurno);
    let endMin = timeToMinutes(fineTurno);
    if (endMin <= startMin) endMin += 24 * 60; // notte
    
    if (!assegnazioni || assegnazioni.length === 0) {
        return [{ inizio: inizioTurno, fine: fineTurno }];
    }

    const intervals = assegnazioni.map(a => {
        let s = timeToMinutes(a.inizio);
        let e = timeToMinutes(a.fine);
        if (s < 12 * 60 && startMin > 12 * 60) s += 24 * 60;
        if (e <= s) e += 24 * 60;
        return { start: s, end: e };
    }).sort((a, b) => a.start - b.start);

    let currentEnd = startMin;
    const buchi = [];

    const formatTime = (mins) => {
        const h = Math.floor((mins % (24 * 60)) / 60);
        const m = mins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    for (const inv of intervals) {
        if (inv.start > currentEnd) {
            buchi.push({ inizio: formatTime(currentEnd), fine: formatTime(inv.start) });
        }
        currentEnd = Math.max(currentEnd, inv.end);
    }
    
    if (currentEnd < endMin) {
        buchi.push({ inizio: formatTime(currentEnd), fine: formatTime(endMin) });
    }
    
    return buchi;
}
