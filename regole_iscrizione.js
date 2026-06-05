/**
 * Modulo per la validazione delle iscrizioni ai turni
 */

export function verificaIscrizione(utente, turno, postoRichiesto) {
  // 1. Verifica che l'utente sia attivo
  if (utente.attivo === false) {
    return { idoneo: false, motivo: "Utente non attivo nel sistema." };
  }

  // Helper ricerca case-insensitive
  const possiedeRuolo = (ruoloCercato) => {
    if (!utente.ruoli_areu || !Array.isArray(utente.ruoli_areu)) return false;
    return utente.ruoli_areu.some(r => r.toLowerCase() === ruoloCercato.toLowerCase());
  };

  // Helper controllo abilitazione sse
  const hasSSE = utente.abilitazioni_servizi && utente.abilitazioni_servizi.sse === true;

  // REGOLE PER SLOT AUTISTA
  if (postoRichiesto === 'autista') {
    if (!possiedeRuolo('Autista MSB')) {
      return { idoneo: false, motivo: "Qualifica di 'Autista MSB' mancante." };
    }
    if (!hasSSE) {
      return { idoneo: false, motivo: "Manca abilitazione 'SSE' obbligatoria." };
    }
  }

  // REGOLE PER SLOT REFERENTE SOREU
  if (postoRichiesto === 'referente_soreu') {
    if (!possiedeRuolo('Socc. Referente per SOREU')) {
      return { idoneo: false, motivo: "Qualifica di 'Socc. Referente per SOREU' mancante." };
    }
    if (!hasSSE) {
      return { idoneo: false, motivo: "Manca abilitazione 'SSE' obbligatoria." };
    }
  }

  // REGOLE PER SLOT SOCCORRITORE
  if (postoRichiesto === 'soccorritore') {
    if (!possiedeRuolo('Soccorritore')) {
      return { idoneo: false, motivo: "Qualifica di 'Soccorritore' mancante." };
    }
    if (!hasSSE) {
      return { idoneo: false, motivo: "Manca abilitazione 'SSE' obbligatoria." };
    }
  }

  // REGOLE PER SLOT ALLIEVO QUARTO POSTO
  if (postoRichiesto === 'allievo_quarto_posto') {
    const haRuoloAllievo = possiedeRuolo('allievo/a') || possiedeRuolo('allievo') || possiedeRuolo('allieva');
    if (!haRuoloAllievo) {
      return { idoneo: false, motivo: "Il posto è riservato esclusivamente al ruolo 'allievo/a'." };
    }
  }

  return { idoneo: true, motivo: "Iscrizione idonea." };
}

/**
 * Verifica se un volontario può iscriversi a un turno rispettando i riposi obbligatori.
 */
export function validaRiposi(nuovoTurnoData, orarioInizio, orarioFine, turniEsistentiDelVolontario) {
    const MIN_RIPOSO_ORE = 11;
    const MILLISECONDS_IN_HOUR = 1000 * 60 * 60;

    const shiftStart = new Date(`${nuovoTurnoData}T${orarioInizio}:00`);
    let shiftEnd = new Date(`${nuovoTurnoData}T${orarioFine}:00`);
    
    if (shiftEnd <= shiftStart) {
        shiftEnd.setDate(shiftEnd.getDate() + 1);
    }

    for (const t of turniEsistentiDelVolontario) {
        const tStart = new Date(`${t.data}T${t.inizio}:00`);
        let tEnd = new Date(`${t.data}T${t.fine}:00`);
        if (tEnd <= tStart) tEnd.setDate(tEnd.getDate() + 1);

        if ((shiftStart >= tStart && shiftStart < tEnd) || 
            (shiftEnd > tStart && shiftEnd <= tEnd) ||
            (shiftStart <= tStart && shiftEnd >= tEnd)) {
            return { idoneo: false, motivo: "Sovrapposizione oraria rilevata con un altro turno assegnato." };
        }

        if (shiftEnd <= tStart) {
            const oreRiposo = (tStart - shiftEnd) / MILLISECONDS_IN_HOUR;
            if (oreRiposo >= 0 && oreRiposo < MIN_RIPOSO_ORE) {
                return { idoneo: false, motivo: `Riposo insufficiente: garantite solo ${oreRiposo.toFixed(1)}h prima del turno successivo (minimo richiesto: ${MIN_RIPOSO_ORE}h).` };
            }
        }
        
        if (shiftStart >= tEnd) {
            const oreRiposo = (shiftStart - tEnd) / MILLISECONDS_IN_HOUR;
            if (oreRiposo >= 0 && oreRiposo < MIN_RIPOSO_ORE) {
                return { idoneo: false, motivo: `Riposo insufficiente: riposo di solo ${oreRiposo.toFixed(1)}h dal turno precedente (minimo richiesto: ${MIN_RIPOSO_ORE}h).` };
            }
        }
    }

    return { idoneo: true, motivo: "Iscrizione valida e conforme alle regole 118." };
}
