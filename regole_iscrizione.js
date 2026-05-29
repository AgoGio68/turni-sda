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
