# Regole di Sviluppo e Versionamento per Agenti AI

Le seguenti regole sono **tassative** e devono essere rispettate per ogni operazione di modifica e rilascio su questo progetto.

## 1. Fonte Unica di Verità per la Versione
L'unico posto in tutto il progetto in cui è definita la versione dell'applicazione è il file **`index.html`**, specificamente all'interno del form di login (cerca il tag `<div class="version-label">`).
- **NON** creare o modificare file come `versione_app.json`.
- **NON** usare il campo version di `package.json` o altri script per mostrare la versione. 

## 2. Obbligo di Aggiornamento Versione
Per **ogni singola modifica** effettuata al codice (che sia un bugfix, una nuova funzionalità o un refactoring):
- È **OBBLIGATORIO** incrementare il numero di versione in `index.html` (es. da `Ver 1.8.9` a `Ver 1.8.10` o `1.9.0` a seconda dell'entità della modifica).
- L'aggiornamento del numero di versione deve avvenire **prima** di effettuare `git commit` e `firebase deploy`.
- Mai procedere a un rilascio senza aver prima verificato e incrementato la versione in quel punto.

Queste regole servono a garantire che gli utenti e gli amministratori vedano sempre in modo inequivocabile quando stanno utilizzando una nuova versione senza problemi di cache del browser.
