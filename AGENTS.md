# AGENTS.md

## Progetto e riferimenti

`bb` è la CLI interna principale in Node.js e TypeScript per Git e Bitbucket Data Center.
Il repository reale è la fonte di verità sullo stato dell'implementazione.

- [README.md](README.md): utilizzo, installazione, limiti e verifiche operative.
- [docs/architecture.md](docs/architecture.md): responsabilità dei moduli e invarianti da preservare.

Prima di modificare un'area, leggere la relativa sezione del documento architetturale e ispezionare codice e test attuali. Non assumere che un esempio documentale coincida con l'implementazione.

## Stack e stile

- Node.js 24 o successivo compatibile, TypeScript, Commander.js e npm.
- Eseguire direttamente TypeScript durante lo sviluppo: `node src/main.ts ...`.
- Rispettare `erasableSyntaxOnly`: niente enum, parameter properties o sintassi che richieda trasformazioni runtime.
- Usare API native Node, `fetch` per HTTP e `child_process` per Git; valutare prima queste API e Commander quando si considera una nuova dipendenza.
- Il build JavaScript in `dist/` serve alla distribuzione npm. Non generare eseguibili durante lo sviluppo.
- Applicare Prettier tramite `npm run format`; rispettare `.editorconfig` e i terminatori LF definiti in `.gitattributes`.
- Codice, commenti, help e messaggi destinati agli utenti o agli sviluppatori devono essere in inglese. Comunicazioni e documentazione progettuale possono essere in italiano.

## Principi di modifica

Privilegiare leggibilità, semplicità, riutilizzabilità, testabilità, basso boilerplate e separazione delle responsabilità, in quest'ordine.

- Riutilizzare le astrazioni esistenti ed evitare duplicazioni.
- Preferire composizione e dipendenze esplicite; non introdurre container DI, globali applicative o classi di servizio senza una necessità concreta.
- Creare moduli soltanto per funzionalità reali, senza directory o file vuoti anticipati.
- Organizzare i moduli per responsabilità e i test per area, seguendo la mappa in `docs/architecture.md`. Separare i tipi condivisi dai dettagli di implementazione; mantenere locali i tipi e gli helper privati. Aggiornare import, percorsi dei test e documentazione quando si sposta un modulo.
- Non effettuare refactoring estesi estranei alla richiesta. Segnalare prima i miglioramenti architetturali significativi non necessari.
- Mantenere `main.ts` come composition root e i registrar dei comandi in `cli/commands/index.ts`.
- Delegare parsing, routing e help a Commander; non introdurre parser manuali o switch sui nomi dei comandi.
- Passare le dipendenze tramite `CommandContext`, usando contratti strutturali con i soli metodi necessari.
- Tutto l'HTTP Bitbucket passa da `BitbucketClient`; tutte le operazioni Git passano da `GitClient`.
- Mantenere pure le regole di dominio Pull Request e separarle da CLI, REST e processi.
- Usare `unknown` per dati non ancora validati e tipi espliciti per le response note; evitare `any`.
- Usare `Error` per validazioni e invarianti. Gli errori custom sono giustificati quando servono informazioni strutturate, come `BitbucketApiError` e `GitCommandError`.

## Invarianti essenziali

- Configurazione globale per utente, obblighi validati lazy; help, configurazione e Git locale devono funzionare senza credenziali Bitbucket.
- Token fuori da `config.json`, mai in command line, output o diagnostiche. Nessun fallback persistente in chiaro.
- L'autenticazione Git usa soltanto l'environment del processo figlio e preserva le impostazioni `GIT_CONFIG_*` esistenti.
- Non avviare processi, leggere token o invocare Git quando il dato non serve o è già disponibile.
- Usare API Bitbucket Data Center sotto `/rest/api/latest/`, mai endpoint Cloud.
- Preservare paginazione, output, exit code, risoluzione dei branch, reviewer e merge check descritti in README e architettura.
- Nessun retry automatico delle scritture REST. Il completamento opzionale dei task non aggira reviewer o merge check.
- `package-lock.json` deve essere versionato; `node_modules/`, artefatti, cache, configurazioni personali e secret devono restare ignorati.

## Verifiche richieste

Dopo ogni modifica significativa:

1. Eseguire `npm run format:check` e `npm run typecheck`, correggendo gli errori.
2. Eseguire i test pertinenti; per modifiche trasversali eseguire `npm test`.
3. Eseguire `npm run test:package` quando cambiano packaging, build, dipendenze runtime o launcher.
4. Riassumere modifiche, verifiche e limiti effettivi.

`npm run check` esegue formattazione, typecheck e suite offline. La verifica del pacchetto rimane separata.

Usare il runner nativo Node. Dare priorità a funzioni pure, dominio, configurazione, branch, reviewer, filtri wildcard, errori REST e contenuto PR. Iniettare `fetch` e l'esecutore Git nei test dei client; usare stub strutturali nei test dei comandi. Conservare le verifiche integrate di parsing, bootstrap, output ed exit code.

I test ordinari non devono richiedere Bitbucket reale o portachiavi personali. Il test DPAPI nativo è opzionale, usa credenziali fittizie isolate e viene abilitato nella CI Windows. Keychain e Secret Service sono simulati nella suite ordinaria.

La CI verifica Node 24 su Windows, Linux e macOS, compreso il tarball installato in un prefisso temporaneo. Non confondere questa copertura con la verifica dei flussi autenticati contro il server aziendale.
