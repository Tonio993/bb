# Architettura di bb

Questo documento descrive responsabilità e invarianti dell'implementazione Node.js principale. Gli esempi dei comandi, le opzioni e le istruzioni di installazione sono nel [README](../README.md). Le regole di modifica sono in [AGENTS.md](../AGENTS.md).

## Responsabilità dei moduli

| Area                | Responsabilità                                                                  |
| ------------------- | ------------------------------------------------------------------------------- |
| `src/main.ts`       | Composition root: store, client, contesto lazy, CLI, errore finale e cleanup.   |
| `src/cli/`          | Parsing Commander, directory temporanea globale, contratti e input del token.   |
| `src/cli/commands/` | Registrar dei comandi, opzioni, risoluzione degli input e output.               |
| `src/application/`  | Orchestrazione del merge, senza URL REST, parsing HTTP, Commander o Git.        |
| `src/bitbucket/`    | Trasporto HTTP, parser delle response, paginazione e operazioni REST.           |
| `src/git/`          | Esecuzione Git, autenticazione selettiva ed errori strutturati.                 |
| `src/auth/`         | Store del token, selezione e implementazioni dei backend sicuri.                |
| `src/config/`       | Configurazione globale, validazione condivisa e persistenza atomica.            |
| `src/repository/`   | Risoluzione centralizzata di project key e repository.                          |
| `src/pull-request/` | Regole pure per branch, reviewer, contenuto, messaggio e validazione del merge. |

## Mappa dei file

```text
src/
  main.ts
  cli/
    cli.ts
    command-context.ts
    token-input.ts
    commands/
      index.ts
      config-command.ts
      token-command.ts
      git-command.ts
      get-pr-url-command.ts
      get-pr-urls-command.ts
      create-pr-command.ts
      merge-pr-command.ts
  application/
    merge-pull-request.ts
  auth/
    token-store.ts
    token-backend.ts
    token-backends.ts
    backends/
      token-command.ts
      windows-dpapi.ts
      macos-keychain.ts
      linux-secret-service.ts
  config/
    config-schema.ts
    config-validation.ts
    config-store.ts
    bitbucket-url.ts
  git/
    git-types.ts
    git-client.ts
    git-command-error.ts
  bitbucket/
    bitbucket-types.ts
    bitbucket-client.ts
    bitbucket-api-error.ts
    response-parsers.ts
    pagination.ts
    repositories.ts
    pull-request-types.ts
    pull-request-search.ts
    pull-requests.ts
    pull-request-tasks.ts
  repository/
    repository-context.ts
  pull-request/
    branches.ts
    reviewers.ts
    pull-request-content.ts
    review-validation.ts
    merge-validation.ts
    merge-commit-message.ts
test/
  cli/
    commands/
  application/
  auth/
  config/
  git/
  bitbucket/
  repository/
  pull-request/
  helpers/
```

## Criteri di organizzazione

I percorsi seguono le responsabilità: tutto l'adattamento al terminale vive in `cli/`, compreso l'input nascosto del token. Lo store e i backend di autenticazione non dipendono dalla CLI. I file sono in kebab-case; classi in PascalCase e funzioni in camelCase conservano i nomi esistenti.

I tipi condivisi hanno una collocazione esplicita. [config-schema.ts](../src/config/config-schema.ts) contiene forma della configurazione, chiavi supportate e relativo controllo; [config-validation.ts](../src/config/config-validation.ts) contiene normalizzazione e validazione pure; [config-store.ts](../src/config/config-store.ts) gestisce filesystem e persistenza. [git-types.ts](../src/git/git-types.ts) raccoglie dati e contratti pubblici Git; il contratto `GitOperations` resta derivato con `Pick<GitClient, ...>` senza duplicare le firme. Il collegamento alla classe è solo di tipo e non introduce un ciclo di caricamento runtime.

Le response Bitbucket restano in [bitbucket-types.ts](../src/bitbucket/bitbucket-types.ts); opzioni e identità delle operazioni PR sono in [pull-request-types.ts](../src/bitbucket/pull-request-types.ts). La ricerca paginata e il filtro repository vivono in [pull-request-search.ts](../src/bitbucket/pull-request-search.ts), separati dalle operazioni REST di [pull-requests.ts](../src/bitbucket/pull-requests.ts). Parser e paginazione rimangono condivisi.

[token-backends.ts](../src/auth/token-backends.ts) seleziona il backend; ogni protocollo nativo ha un file in `auth/backends/`. Il modulo `token-command.ts` condivide esecuzione sicura, tipi del runner e identità delle credenziali. I backend mantengono timeout, protezione dei secret e diagnostiche centralizzati.

I tipi privati e gli helper usati da un solo modulo restano accanto all'implementazione. Le funzioni di dominio rimangono funzioni pure; non sono introdotte classi di servizio o directory generiche `types`, `utils` o `services`. Gli import puntano al modulo che possiede la definizione: non mantenere re-export dei vecchi percorsi o barrel generici. `cli/commands/index.ts` è il punto di registrazione dei comandi.

I test seguono le aree di `src/`, con gli helper condivisi in `test/helpers/`. I test puri di branch, reviewer e contenuto PR sono separati per argomento. Per eseguire un'area usare, ad esempio, `node --test "test/config/*.test.ts"`; per i comandi usare `node --test "test/cli/commands/*.test.ts"`. `npm test` seleziona ricorsivamente solo i file `*.test.ts`, includendo tutte le aree ed escludendo gli helper.

## Composizione e CLI

`main.ts` costruisce gli store e inizializza lazy configurazione e client. I comandi ricevono un `CommandContext`; i contratti `BitbucketApi`, `GitOperations` e i `Pick` degli store espongono i metodi usati senza imporre istanze concrete ai consumer.

Ogni comando si registra con `register...Command(program, context)`. L'elenco dei registrar risiede in `cli/commands/index.ts`; Commander gestisce routing, help e parsing. I nomi delle opzioni sono in kebab-case.

`-C` / `--path` prima del comando cambia temporaneamente la directory. Il cleanup la ripristina anche dopo help o errori. Dopo `bb git`, gli argomenti appartengono invece a Git: `bb git -C ...` deve inoltrare l'opzione senza interpretarla.

L'help esplicito termina con successo; parsing e errori applicativi producono una diagnostica su stderr ed exit code 1. Il pass-through propaga l'exit code Git. Help, configurazione e operazioni locali non devono inizializzare servizi Bitbucket o recuperare token.

## Configurazione globale

`ConfigStore` centralizza lettura, normalizzazione e persistenza. Il file è globale per utente:

| Piattaforma | Percorso                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| Windows     | `%APPDATA%/bb/config.json`                                               |
| Linux       | `$XDG_CONFIG_HOME/bb/config.json`, altrimenti `~/.config/bb/config.json` |
| macOS       | `~/Library/Application Support/bb/config.json`                           |

Le chiavi obbligatorie sono `bitbucket.url` e `bitbucket.projectKey`; quelle opzionali sono `bitbucket.defaultReviewers` e `git.remote`, con default rispettivamente lista vuota e `origin`.

Gli obblighi vengono verificati da `loadRequired` e dal salvataggio completo `save`, senza bloccare `config init` in assenza di un file. Gli errori indicano la chiave e i comandi per configurarla. `config init` conserva il default quando l'utente preme Invio. `list` e `init` sono sottocomandi Commander e non accettano argomenti aggiuntivi.

`get`, `snapshot`, `set`, `save` e `loadRequired` condividono le regole di normalizzazione. Le stringhe presenti non possono essere vuote dopo il trim. `get` verifica sempre la struttura JSON, ma applica le regole semantiche solo alla chiave richiesta: Git locale resta indipendente da un URL Bitbucket non valido. `snapshot` legge una volta tutti i valori con i default; `config list` e i default di `config init` usano una singola snapshot per invocazione, senza cache globale obsoleta.

La normalizzazione in `config/bitbucket-url.ts` è condivisa con Git: URL HTTP/HTTPS assoluto, senza credenziali, wildcard nell'host, query, fragment o spazi interni. Conserva il context path, normalizza host e porta tramite `URL` e rimuove gli slash finali. Gli errori non devono mostrare l'URL inserito.

La scrittura usa un temporaneo esclusivo nella stessa directory, chiusura e `renameSync` per sostituire la destinazione. Un errore preserva il file precedente e ripulisce il temporaneo: nessuna cancellazione preventiva o scrittura diretta di ripiego. Gli aggiornamenti di singole chiavi conservano i campi sconosciuti.

## Token e backend sicuri

`TokenStore` riceve un `TokenBackend` con nome, lettura, scrittura e cancellazione. Gestisce precedenza di `BB_TOKEN`, validazione e cache, senza dipendere da filesystem o processi. Il bootstrap seleziona il backend tramite `createTokenBackend` senza leggerlo o eseguire comandi; `BB_TOKEN` funziona anche su piattaforme senza backend supportato.

| Piattaforma | Backend                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| Windows     | DPAPI tramite `powershell.exe`, file `%APPDATA%/bb/token.dat`.                            |
| macOS       | Keychain, servizio `bb.bitbucket`, account `token`.                                       |
| Linux       | Secret Service tramite `secret-tool`, attributi `service=bb.bitbucket` e `account=token`. |

Nessun fallback su file in chiaro. I backend inviano i secret tramite stdin, rimuovono `BB_TOKEN` dall'environment figlio e applicano timeout, limite di output e diagnostiche filtrate. Non inoltrare stderr nativo senza filtraggio. Lo store mantiene il token lazy in memoria per l'esecuzione e il bootstrap svuota la cache nel `finally`.

Il backend Windows rimuove anche `PSModulePath` dall'environment figlio, senza modificare quello del chiamante. Quando `powershell.exe` viene avviato attraverso Node da PowerShell 7, può ereditare percorsi di moduli incompatibili; l'assenza della variabile permette a Windows PowerShell di ricostruire i propri percorsi standard, come descritto nella [documentazione Microsoft](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath#starting-windows-powershell-from-powershell-7). Il test DPAPI nativo include un modulo incompatibile simulato per verificare questo isolamento.

`token set` usa input nascosto o `--stdin`, mai argomenti posizionali. `token status` mostra solo la sorgente e termina con codice 1 quando manca il token. Scrittura e cancellazione modificano lo store persistente, senza alterare `BB_TOKEN`.

## Trasporto Bitbucket

Il server è Bitbucket Data Center, con API `/rest/api/latest/`. Tutte le richieste passano da `BitbucketClient`: URL base e context path, Bearer, header JSON, serializzazione, lettura e gestione errori sono centralizzati. I comandi non invocano `fetch`.

Ogni richiesta ha una deadline predefinita di 60 secondi, inclusa la lettura del corpo; il timer viene sempre rimosso. Il costruttore accetta timeout e `fetch` sostituibili. Non introdurre retry automatici, soprattutto per creazione, merge e task: una scrittura può essere riuscita prima dell'errore osservato dal client.

Senza parser il risultato è `unknown`. Per ottenere dati tipizzati, gli endpoint passano parser di `response-parsers.ts`: validano i campi usati accettando quelli aggiuntivi. Rifiutare JSON malformato, HTML e strutture incomplete senza mostrare il corpo delle response di successo. I parser che richiedono JSON devono rifiutare anche i corpi vuoti; il trasporto consente invece response vuote quando appropriate.

`BitbucketApiError` conserva status quando disponibile, metodo, percorso e messaggio, anche per errori di lettura, deadline e validazione. Gli errori HTTP mantengono il parsing di messaggi JSON o testuali. Usare le informazioni strutturate anziché analizzare stringhe.

`iterateBitbucketPages` gestisce repository, PR e task: `start`, `limit=100`, parser, `values`, `isLastPage` e `nextPageStart`. Il prossimo indice deve essere un intero sicuro strettamente crescente. Le richieste sono lazy e sequenziali; non anticipare pagine dopo l'uscita del consumer.

## Git

`GitClient` centralizza processi e errori. Usa output ereditato nel pass-through e acquisito per le operazioni interne, con limite di 16 MiB. `show-ref --verify --quiet` considera assente soltanto exit code 1; gli altri errori e i segnali sono propagati come `GitCommandError`, che conserva argomenti, exit code e segnale quando disponibile.

Le operazioni locali non leggono token o URL Bitbucket. Nel pass-through il riconoscimento dell'autenticazione copre i comandi diretti `fetch`, `pull`, `push`, `clone` e `ls-remote`, anche dopo opzioni globali come `-C` e `-c`. Alias e altri sottocomandi restano affidati all'autenticazione nativa di Git.

L'autenticazione non inserisce token negli argomenti: usa `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n` e `GIT_CONFIG_VALUE_n` solo nel processo figlio. L'header `Authorization: Bearer ...` è limitato a `http.<bitbucket.url>/.extraHeader`, inclusi context path e slash finale, per non raggiungere altri server o percorsi. La lettura dell'URL è lazy e indipendente dal project key.

Preservare le configurazioni Git ereditate. `GIT_CONFIG_COUNT` deve essere un intero decimale non negativo incrementabile senza perdita di precisione: non reinterpretare input malformati come zero. Il costruttore consente di iniettare `execute` nei test, senza sostituire globalmente `spawnSync`.

## Repository, branch e ricerca PR

`RepositoryContext` risolve il project key da override CLI e poi configurazione, e il repository da override esplicito e poi Git corrente. Non duplicare la logica nei comandi.

Con un solo branch posizionale, il source è quello corrente e il target è l'argomento. Con due branch entrambi sono espliciti. Source e target non possono coincidere; non interrogare Git quando sono già noti.

`get-pr-url` cerca una PR aperta nel repository e termina al primo risultato corrispondente. `get-pr-urls` cerca nei repository del progetto e filtra nome e slug con wildcard `*` e `?`, senza distinzione tra maiuscole e minuscole. Entrambi stampano solo URL; nessun risultato significa nessun output ed exit code di successo.

## Creazione PR

`create-pr` effettua fetch, verifica source e target remoti e legge il confronto `remote/target..remote/source`, senza usare branch locali per il contenuto. Esclude merge commit e ordina dal più vecchio al più recente tramite `--no-merges --reverse`.

`buildPullRequestContent(commits, sourceBranch)` è pura, accetta dati readonly e non modifica input né invoca Git. Con un solo commit usa il subject come titolo, altrimenti il source branch. La descrizione resta una lista Markdown anche per un solo commit, con il body annidato e `&nbsp;` fra i commit. Un confronto vuoto produce un errore che conserva i riferimenti source e target.

I reviewer configurati sono il default. `--reviewer` ripetibile o separato da virgole li sostituisce; `--no-reviewers` li disabilita. Le due opzioni sono incompatibili. La semantica Commander `options.reviewers === false` è mantenuta.

## Merge PR

`mergeOpenPullRequest` orchestra ricerca, rilettura, validazione, task opzionali, messaggio e merge. I moduli REST espongono operazioni su PR, suggerimento del messaggio e task; le regole pure risiedono in `pull-request/merge-validation.ts`. Non introdurre checkout, pull, merge locale, push o stash.

Il merge usa `POST .../pull-requests/{id}/merge` con versione corrente e rispetta i merge check del server. Una PR senza reviewer è ammessa; se sono presenti, ne serve almeno uno `APPROVED`. Qualunque `NEEDS_WORK` blocca il merge.

`--message-prefix` si applica al messaggio effettivo creato da Bitbucket: leggere il suggerimento, anteporre il prefisso e inviare il messaggio esplicito evitando un secondo subject automatico quando supportato.

Senza `--complete-tasks` i task non vengono modificati. Con l'opzione:

1. Validare stato, versione e reviewer della PR.
2. Raccogliere tutte le pagine dei task prima di aggiornarli, evitando spostamenti degli indici durante la paginazione.
3. Rileggere ciascun task da completare e usare la versione corrente.
4. Impostare a `RESOLVED` solo i task ancora aperti.
5. Rileggere la PR e ricontrollare branch, stato, versione e reviewer prima del merge.

Un errore o conflitto interrompe il flusso senza tentare il merge; i task già risolti restano risolti. L'opzione non disattiva reviewer o merge check e non giustifica retry che sovrascrivano modifiche concorrenti.

## Build, distribuzione e verifica

Durante lo sviluppo Node esegue TypeScript direttamente. Il build con `tsconfig.build.json` genera il JavaScript di distribuzione; `prepack` lo avvia e il launcher npm punta a `dist/main.js`. Il pacchetto è privato: la distribuzione interna usa `npm pack` e l'installazione globale del tarball.

L'allowlist del pacchetto comprende solo runtime JavaScript, manifest, README e Commander con licenza, incluso tramite `bundleDependencies`. `npm run test:package` verifica contenuti, installazione offline con cache vuota e dipendenze di produzione, launcher e configurazione fittizia. Prefisso e dati temporanei sono isolati e ripuliti, senza modificare l'installazione globale o la configurazione reale.

La suite nativa Node seleziona `test/**/*.test.ts`; gli helper non vengono eseguiti come suite. I test usano dipendenze sostituibili e mantengono le verifiche integrate della CLI. La CI in [.github/workflows/ci.yml](../.github/workflows/ci.yml) esegue formattazione, typecheck, suite e pacchetto su Node 24 in Windows, Linux e macOS; abilita inoltre il round trip DPAPI isolato su Windows.

Il job `package` dipende dal successo dell'intera matrice `verify`. Su un checkout pulito Ubuntu installa le dipendenze con `npm ci` e genera `out/bb-<versione>.tgz` tramite `npm pack`, includendo build e Commander. `actions/upload-artifact` conserva soltanto i tarball per 30 giorni nell'artifact `bb-package-<commit SHA>`, senza eseguire `npm publish` o creare release. Il job usa gli stessi trigger della verifica, incluse Pull Request ed esecuzioni manuali.

I backend macOS e Linux sono verificati tramite tool simulati e richiedono prove native nei rispettivi ambienti. Restano da verificare i flussi autenticati contro il server aziendale e da scegliere il canale interno di release. La cancellazione del source branch non è implementata e va valutata separatamente.
