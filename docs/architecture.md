# Architettura di bb

Questo documento descrive responsabilità e invarianti dell'implementazione Node.js principale. Gli esempi dei comandi, le opzioni e le istruzioni di installazione sono nel [README](../README.md). Le regole di modifica sono in [AGENTS.md](../AGENTS.md).

## Responsabilità dei moduli

| Area                | Responsabilità                                                                  |
| ------------------- | ------------------------------------------------------------------------------- |
| `src/main.ts`       | Composition root: store, client, contesto lazy, CLI, errore finale e cleanup.   |
| `src/cli/`          | Parsing Commander, directory temporanea globale, contratti e input del token.   |
| `src/cli/commands/` | Registrar dei comandi, opzioni, risoluzione degli input e output.               |
| `src/application/`  | Orchestrazione del merge e della diagnostica tramite dipendenze esplicite.      |
| `src/diagnostics/`  | Lettura della versione npm e ricerca locale degli eseguibili dei backend.       |
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
    doctor-report.ts
    json-output-types.ts
    json-output.ts
    json-errors.ts
    pull-request-output.ts
    token-input.ts
    commands/
      index.ts
      config-command.ts
      doctor-command.ts
      token-command.ts
      git-command.ts
      get-pr-url-command.ts
      get-pr-urls-command.ts
      create-pr-command.ts
      merge-pr-command.ts
  application/
    doctor/
      run-doctor.ts
      local-diagnostics.ts
      credential-diagnostics.ts
      remote-diagnostics.ts
      doctor-types.ts
    merge-pull-request.ts
    merge-pull-request-types.ts
  diagnostics/
    executable.ts
    npm-version.ts
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
    ssh-hostnames.ts
  git/
    git-types.ts
    git-client.ts
    git-command-error.ts
  bitbucket/
    authentication.ts
    bitbucket-types.ts
    bitbucket-client.ts
    bitbucket-api-error.ts
    response-parsers.ts
    pagination.ts
    repositories.ts
    branches.ts
    branch-types.ts
    pull-request-types.ts
    pull-request-search.ts
    pull-requests.ts
    pull-request-tasks.ts
  repository/
    remote-url.ts
    remote-url-types.ts
    repository-context.ts
    repository-types.ts
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
    doctor/
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

I test seguono le aree di `src/`, con gli helper condivisi in `test/helpers/`. La diagnostica applicativa è raccolta in `test/application/doctor/`; parsing, output ed exit code del comando restano in `test/cli/commands/doctor-command.test.ts`. Le prove del composition root sono separate in `test/cli/doctor-bootstrap.test.ts` e riutilizzano la configurazione temporanea isolata di `test/helpers/doctor-fixture.ts`. Le sostituzioni delle funzioni native sono limitate ai subprocessi di bootstrap; classificazione degli errori e prerequisiti sono testati direttamente tramite funzioni e dipendenze esplicite. I test puri di branch, reviewer e contenuto PR sono separati per argomento. Per eseguire un'area usare, ad esempio, `node --test "test/config/*.test.ts"`; per i comandi usare `node --test "test/cli/commands/*.test.ts"`. `npm test` seleziona ricorsivamente solo i file `*.test.ts`, includendo tutte le aree ed escludendo gli helper.

## Composizione e CLI

`main.ts` costruisce gli store e inizializza lazy configurazione e client. I comandi ricevono un `CommandContext`; i contratti `BitbucketApi`, `GitOperations` e i `Pick` degli store espongono i metodi usati senza imporre istanze concrete ai consumer.

Ogni comando si registra con `register...Command(program, context)`. L'elenco dei registrar risiede in `cli/commands/index.ts`; Commander gestisce routing, help e parsing. I nomi delle opzioni sono in kebab-case.

`-C` / `--path` prima del comando cambia temporaneamente la directory. Il cleanup la ripristina anche dopo help o errori. Dopo `bb git`, gli argomenti appartengono invece a Git: `bb git -C ...` deve inoltrare l'opzione senza interpretarla.

L'help esplicito termina con successo; in modalità testuale parsing e errori applicativi producono una diagnostica su stderr ed exit code 1. Il pass-through propaga l'exit code Git. Help, configurazione e operazioni locali non devono inizializzare servizi Bitbucket o recuperare token.

## Output JSON

Il contratto pubblico versionato è in [json-output.md](json-output.md); la numerazione delle evolutive è conservata in [roadmap.md](roadmap.md). Il formato è opt-in tramite `--json` globale prima del comando oppure locale sui cinque comandi supportati: `get-pr-url`, `get-pr-urls`, `create-pr`, `merge-pr` e `doctor`. Le opzioni locali sono dichiarate nei rispettivi registrar. Commander resta responsabile del parsing: non si cercano flag nell'array degli argomenti e non si aggiunge routing sui nomi dei comandi.

`json-output-types.ts` definisce envelope, codici di errore e proiezione delle PR. `json-output.ts` legge gli option values di Commander, ricava il nome canonico dai parent e scrive un solo documento su stdout, impostando exit code `0` o `1`. `pull-request-output.ts` proietta solo metadati PR documentati: nessuna serializzazione diretta delle response REST. I link vengono limitati a HTTP(S), senza userinfo, query o fragment, con `null` per link non disponibili o non validi. Le identità source e target restano distinte per supportare i fork.

`runCli` consulta esclusivamente lo stato delle opzioni nei Command per selezionare il formato anche in caso di errore. Configura `writeErr` prima di registrare i comandi, così i figli ereditano la soppressione delle diagnostiche testuali quando JSON è già attivo. Il catch tratta gli errori JSON e restituisce un risultato con dati null; in modalità testuale propaga gli errori al gestore esistente di `main.ts`. Il ripristino della directory e il cleanup del token restano attivi. L'help esplicito resta testuale. Il `preAction` rifiuta JSON sui comandi che non dichiarano l'opzione, prima di modificare directory o inizializzare dipendenze. Il pass-through Git mantiene tutti gli argomenti successivi al proprio comando.

`json-errors.ts` traduce `CommanderError`, `BitbucketApiError` e `GitCommandError` in codici e messaggi controllati, conservando soltanto status, metodo, kind ed exit code/segnale Git quando disponibili. Non analizza messaggi per classificare errori e non serializza testo nativo, corpi HTTP, path, argomenti Git, stack o cause native. Gli errori generici hanno un codice e un messaggio fissi. `SOURCE_DELETION_FAILED` conserva la PR mergiata e una causa filtrata; `DIAGNOSTIC_FAILED` conserva i controlli e i conteggi di doctor. La modalità JSON non introduce nuove letture, processi o retry.

`test/cli/json-output.test.ts` verifica i cinque comandi, modalità globale/locale, risultati vuoti, errori, segreti aggiuntivi nelle response, successi parziali e isolamento del pass-through. `json-bootstrap.test.ts` verifica il processo reale, stdout/stderr, exit code, diagnostica, credenziali lazy e cleanup. Il pacchetto installato viene verificato in entrambi i formati per ricerca, merge e relativi esiti parziali, oltre a doctor con credenziali fittizie.

## Diagnostica locale

`doctor` riceve tramite `CommandContext.doctor` una funzione asincrona composta in `main.ts`. `application/doctor/run-doctor.ts` coordina i controlli; `application/doctor/local-diagnostics.ts` verifica versione Node, provider delle versioni npm/Git e store di configurazione. `CommandContext.doctor` restituisce sempre una `Promise<DoctorCheck[]>`; gli stub dei test rispettano lo stesso contratto. I moduli applicativi restituiscono risultati senza stampare né impostare exit code. Il registrar attende i risultati e si occupa di output ed exit code: `1` con almeno un `FAIL`, altrimenti `0`. File assente, chiavi obbligatorie mancanti o strumenti non adatti all'installazione Git producono `WARN`; runtime incompatibile, strumenti non eseguibili e configurazione non valida producono `FAIL`.

`application/doctor/doctor-types.ts` contiene il contratto condiviso di risultati, stati e opzioni, separato dai controlli locali. `cli/doctor-report.ts` contiene le funzioni pure per conteggi condivisi e rapporto testuale: mantiene l'ordine dei controlli, conta `OK`, `WARN`, `FAIL`, `SKIP`, aggiunge il riepilogo finale e calcola l'exit code. Il registrar stampa il rapporto su stdout e applica sempre quel codice; con `--json` emette invece controlli e conteggi nell'envelope versionato. Gli errori Commander sono testuali su stderr per default e strutturati su stdout quando JSON è già attivo. Un controllo saltato non viene contato come successo. L'help espone le regole anche senza inizializzare dipendenze.

La versione Node proviene dal processo corrente. `diagnostics/npm-version.ts` esegue soltanto `npm --version`, con timeout di 10 secondi, limite di output di 64 KiB e `BB_TOKEN` rimosso dall'environment utile del figlio. Su Windows usa `cmd.exe /d /s /c` con comando fisso per avviare il launcher npm; sulle altre piattaforme esegue npm direttamente. La versione Git passa da `GitClient.version()`, con timeout di 10 secondi e senza autenticazione o letture della configurazione. Il client diagnostico è indipendente dal client dei comandi Git per funzionare anche con un file di configurazione danneggiato.

Lo store viene interrogato tramite `exists()` e una sola `snapshot()` quando il file è presente. Si mostra il percorso, ma non i valori, i contenuti JSON o gli errori nativi non filtrati. Un controllo fallito non interrompe gli altri. Non si scrivono file; senza `--remote` non si inizializza il client Bitbucket.

`application/doctor/credential-diagnostics.ts` aggiunge la diagnostica delle credenziali. `TokenStore.describeSource()` restituisce soltanto la sorgente prevista e il tool dichiarato dal backend, senza letture né validazione del secret. La presenza di `BB_TOKEN`, anche vuota, evita di ispezionare il backend. `diagnostics/executable.ts` verifica file e permessi di esecuzione tramite percorso assoluto o `PATH`, senza avviare il tool; non garantisce l'accessibilità della sessione del portachiavi.

I backend condividono inoltre il proprio suggerimento statico di ripristino tramite `hint`, riutilizzato dal runner delle operazioni token e dalla diagnostica. La descrizione resta priva di secret e non esegue processi. Questo consente indicazioni specifiche per DPAPI, Keychain e Secret Service senza duplicare i messaggi. Un backend non supportato o un tool assente lascia la lettura `SKIP`.

Il registrar passa `DoctorOptions.checkToken` tramite il contesto. Senza opzione la lettura è `SKIP`; con `--check-token` si usa `TokenStore.inspectCredential()`, che legge e valida senza restituire il secret e senza popolare la cache. Tool assente o backend non supportato producono `WARN` per default e `FAIL` se si richiede la lettura; token assente, valore non valido o errore di accesso durante la verifica esplicita producono `FAIL`. La mancanza del tool impedisce di tentare la lettura. Gli errori sono filtrati; non si effettuano scritture o verifiche di autenticazione remote. La lettura può richiedere autorizzazione al sistema operativo e mantiene il timeout nativo di 60 secondi dei backend.

`DoctorOptions.remote` abilita la verifica remota e implica la lettura della credenziale. I controlli locali restituiscono `LocalDiagnosis`, composto da righe del rapporto e URL del server validato: l'orchestratore riutilizza questo URL senza rileggere il file né imporre la project key. Soltanto quando la validazione completa della snapshot fallisce, il controllo locale tenta un `get` della singola chiave URL se è richiesta la prova remota, preservando l'indipendenza da errori semantici di altre impostazioni. Se l'URL non è utilizzabile, evita di leggere il token, salvo un `checkToken` esplicito. Per il controllo remoto richiede `TokenStore.inspectCredential({ cacheForUse: true })`, così `get()` riutilizza il token validato senza un secondo processo del portachiavi; `main.ts` svuota la cache nel `finally`. Il comportamento di `inspectCredential()` senza opzioni resta privo di cache. La diagnostica delle credenziali restituisce `CredentialDiagnosis`, con le righe del rapporto e `readyForRemote`: soltanto l'ispezione riuscita abilita il client HTTP. L'orchestratore non deduce i prerequisiti dagli stati o dai messaggi destinati al rapporto.

`bitbucket/authentication.ts` esegue una sola GET alla dashboard delle PR dell'utente autenticato, con `limit=1`, sotto `/rest/api/latest/`; valida la pagina tramite `parsePage` senza usare o mostrare il contenuto delle PR. La scelta dell'endpoint segue la [documentazione Data Center](https://developer.atlassian.com/server/bitbucket/rest/v819/api-group-dashboard/) ed evita di dedurre l'autenticazione da risorse potenzialmente pubbliche. Non verifica permessi su progetti o repository; credenziali limitate a tali risorse potrebbero non accedere alla dashboard. La compatibilità con le policy e la versione aziendale richiede una prova reale.

Il client diagnostico usa l'URL configurato, un timeout di 10 secondi e redirect `manual`, senza modificare il comportamento predefinito degli altri client. `classifyRemoteFailure` in `application/doctor/remote-diagnostics.ts` è una funzione pura che traduce status HTTP e `BitbucketApiError.kind` (`http`, `connection`, `timeout`, `response`) in risultati filtrati: nessuna analisi dei messaggi d'errore, nessuna stampa del corpo o degli errori nativi. Una risposta HTTP conferma soltanto la raggiungibilità; dashboard JSON valida conferma accesso autenticato. HTTP 401 e 403 vengono descritti senza dedurre con certezza la validità del token. Timeout, SSO/redirect, JSON inatteso e problemi del server producono errori distinti. Non vengono eseguiti retry né scritture REST.

Senza risposta HTTP, l'autenticazione è `SKIP`, anche in caso di timeout; se il timeout avviene leggendo il corpo, la connessione è raggiunta ma l'autenticazione non è confermata e produce `FAIL`. Uno status HTTP di errore già disponibile conserva la propria diagnosi anche se il corpo non è leggibile. HTTP 429 indica di attendere prima di ripetere il comando. I messaggi di configurazione, tool e validazione locale del token descrivono soltanto il proprio controllo, senza anticipare l'esito remoto.

## Configurazione globale

`ConfigStore` centralizza lettura, normalizzazione e persistenza. Il file è globale per utente:

| Piattaforma | Percorso                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| Windows     | `%APPDATA%/bb/config.json`                                               |
| Linux       | `$XDG_CONFIG_HOME/bb/config.json`, altrimenti `~/.config/bb/config.json` |
| macOS       | `~/Library/Application Support/bb/config.json`                           |

`bitbucket.url` è obbligatorio per i comandi REST e Git autenticato. `bitbucket.projectKey` è opzionale nella configurazione generale: il progetto può provenire dal remote o da `--project-key`. Soltanto `get-pr-urls` richiede il default o un override esplicito, tramite `requireProjectKey` prima di accedere al client HTTP. `bitbucket.defaultReviewers` e `bitbucket.sshHostnames` hanno default lista vuota; `git.remote` ha default `origin`. `doctor` considera valida una configurazione con URL anche senza progetto globale.

`loadRequired` e il salvataggio completo `save` verificano l'URL senza imporre un progetto globale, e non bloccano `config init` in assenza di un file. Gli errori indicano la chiave e i comandi per configurarla. `config init` conserva il default quando l'utente preme Invio, consente di lasciare assente il progetto e conserva le associazioni SSH esistenti. `list` e `init` sono sottocomandi Commander e non accettano argomenti aggiuntivi.

`get`, `snapshot`, `set`, `save` e `loadRequired` condividono le regole di normalizzazione. Le stringhe presenti non possono essere vuote dopo il trim. `get` verifica sempre la struttura JSON, ma applica le regole semantiche solo alla chiave richiesta: Git locale resta indipendente da un URL Bitbucket non valido. `snapshot` legge una volta tutti i valori con i default; `config list` e i default di `config init` usano una singola snapshot per invocazione, senza cache globale obsoleta.

La normalizzazione in `config/bitbucket-url.ts` è condivisa con Git: URL HTTP/HTTPS assoluto, senza credenziali, wildcard nell'host, query, fragment o spazi interni. Conserva il context path, normalizza host e porta tramite `URL` e rimuove gli slash finali. Gli errori non devono mostrare l'URL inserito.

`config/ssh-hostnames.ts` condivide tra configurazione e resolver la normalizzazione degli hostname SSH esplicitamente associati al server. La lista è un array JSON; `bb config bitbucket.sshHostnames <lista>` accetta valori separati da virgole e una stringa vuota per azzerarla. Hostname e IPv6 vengono normalizzati e deduplicati; porte, percorsi, userinfo e wildcard sono rifiutati senza riportare l'input. Le scritture non sostituiscono la configurazione se un elemento è invalido. Le letture di singole altre chiavi restano indipendenti da un errore semantico nella lista.

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

Il server è Bitbucket Data Center, con API `/rest/api/latest/` e `/rest/branch-utils/latest/` per la cancellazione condizionata dei branch. Tutte le richieste passano da `BitbucketClient`: URL base e context path, Bearer, header JSON, serializzazione, lettura e gestione errori sono centralizzati. I comandi non invocano `fetch`.

Il contratto strutturale `BitbucketApi` comprende GET, POST, PUT e DELETE. `delete` accetta un body JSON opzionale e un parser, mantenendo l'overload preesistente con il solo parser come secondo argomento. Una risposta 204 senza contenuto resta `undefined`. `bitbucket/branches.ts` e `branch-types.ts` possiedono operazione e opzioni di cancellazione; richiedono ref completo, progetto, repository e commit atteso, inviati al modulo `branch-utils` con `dryRun: false`. Il parser dell'operazione rifiuta corpi di successo inattesi.

`BitbucketClient` riceve soltanto l'URL base, il provider del token e le opzioni di trasporto: non richiede project key o reviewer, che appartengono ai comandi. Il client diagnostico non usa valori fittizi di configurazione.

Ogni richiesta ha una deadline predefinita di 60 secondi, inclusa la lettura del corpo; il timer viene sempre rimosso. Il costruttore accetta timeout e `fetch` sostituibili. Non introdurre retry automatici, soprattutto per creazione, merge e task: una scrittura può essere riuscita prima dell'errore osservato dal client.

Senza parser il risultato è `unknown`. Per ottenere dati tipizzati, gli endpoint passano parser di `response-parsers.ts`: validano i campi usati accettando quelli aggiuntivi. Rifiutare JSON malformato, HTML e strutture incomplete senza mostrare il corpo delle response di successo. I parser che richiedono JSON devono rifiutare anche i corpi vuoti; il trasporto consente invece response vuote quando appropriate.

`BitbucketApiError` conserva status quando disponibile, metodo, percorso e messaggio, anche per errori di lettura, deadline e validazione. Gli errori HTTP mantengono il parsing di messaggi JSON o testuali. Usare le informazioni strutturate anziché analizzare stringhe.

`iterateBitbucketPages` gestisce repository, PR e task: `start`, `limit=100`, parser, `values`, `isLastPage` e `nextPageStart`. Il prossimo indice deve essere un intero sicuro strettamente crescente. Le richieste sono lazy e sequenziali; non anticipare pagine dopo l'uscita del consumer.

## Git

`GitClient` centralizza processi e errori. Usa output ereditato nel pass-through e acquisito per le operazioni interne, con limite di 16 MiB. `show-ref --verify --quiet` considera assente soltanto exit code 1; gli altri errori e i segnali sono propagati come `GitCommandError`, che conserva argomenti, exit code e segnale quando disponibile.

Le operazioni locali non leggono token o URL Bitbucket. Nel pass-through il riconoscimento dell'autenticazione copre i comandi diretti `fetch`, `pull`, `push`, `clone` e `ls-remote`, anche dopo opzioni globali come `-C` e `-c`. Alias e altri sottocomandi restano affidati all'autenticazione nativa di Git.

L'autenticazione non inserisce token negli argomenti: usa `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n` e `GIT_CONFIG_VALUE_n` solo nel processo figlio. L'header `Authorization: Bearer ...` è limitato a `http.<bitbucket.url>/.extraHeader`, inclusi context path e slash finale, per non raggiungere altri server o percorsi. La lettura dell'URL è lazy e indipendente dal project key.

Preservare le configurazioni Git ereditate. `GIT_CONFIG_COUNT` deve essere un intero decimale non negativo incrementabile senza perdita di precisione: non reinterpretare input malformati come zero. Il costruttore consente di iniettare `execute` nei test, senza sostituire globalmente `spawnSync`.

`GitClient.remoteFetchUrl(remote = this.remote)` legge l'URL di fetch tramite `git remote get-url -- <remote>`, con acquisizione dell'output, timeout di 10 secondi e autenticazione disabilitata. Il separatore `--` mantiene il nome del remote come argomento posizionale. Si usa il primo URL di fetch e si delegano a Git le regole `insteadOf`, senza selezionare URL di push o eseguire operazioni di rete, come descritto nella [documentazione Git](https://git-scm.com/docs/git-remote). Nome del remote vuoto e risposta vuota producono errori di validazione; gli altri errori sono `GitCommandError` che conservano argomenti, exit code e segnale disponibili, senza riportare stdout, stderr, errori nativi o cause che potrebbero contenere credenziali.

Il metodo restituisce l'URL grezzo, da passare al parser senza stamparlo: può includere userinfo già presente nella configurazione Git. Non legge il token Bitbucket né l'URL del server, non modifica la configurazione e non memorizza il risultato in cache. La prova nativa usa un repository temporaneo isolato per verificare riscritture, più URL di fetch, URL di push distinto, remote assente e directory esterna a Git. Il contratto strutturale `GitOperations` include il metodo e gli stub dei comandi ne impediscono chiamate inattese. `resolveRepositoryContext` usa questo lettore con il nome del remote configurato.

## Repository, branch e ricerca PR

`resolveRepositoryContext` centralizza la risoluzione dell'identità; i contratti `RepositoryContext`, `RepositoryContextConfig` e `ResolveRepositoryContextOptions` vivono in `repository/repository-types.ts`. Riceve URL del server, project key opzionale, nome del remote, associazioni SSH e un provider lazy del solo metodo Git `remoteFetchUrl`. I comandi non duplicano questa logica. Il provider evita di inizializzare il client Git quando l'identità è già completa.

Nella risoluzione automatica il progetto esplicito prevale su quello del remote, e il repository viene dal remote. Il project key globale non sostituisce quello riconosciuto. Se il repository è esplicito, si usa il progetto esplicito oppure quello configurato; quando entrambi i dati sono così disponibili non si invoca Git né si valida l'URL inutilizzato. Se manca il progetto anche con repository esplicito, si ricava dal remote. I valori manuali vengono ripuliti dagli spazi esterni; override vuoti sono ignorati. Non esiste fallback al nome della directory o al progetto globale quando il repository deve essere scoperto. Gli errori Git vengono propagati senza alterarne exit code o segnale.

Prima della lettura Git si valida l'URL configurato. Un remote HTTP(S) è accettato soltanto se protocollo, hostname, porta normalizzata e context path corrispondono al server; il percorso viene confrontato per segmenti decodificati e ricodificati una volta. Un remote SSH deve avere lo stesso hostname del server HTTP oppure comparire in `bitbucket.sshHostnames`; un'opzione `sshHostnames` passata direttamente al resolver sostituisce la lista configurata. Le associazioni accettano hostname o IPv6 tra parentesi quadre, senza userinfo, porta, percorso o wildcard, e valgono soltanto per SSH. Porte e prefissi SSH possono differire da quelli HTTP; non si eseguono DNS, letture della configurazione SSH o processi per indovinare alias. Errori di corrispondenza e validazione non riportano l'URL grezzo.

`get-pr-url`, `create-pr` e `merge-pr` passano al resolver `--project-key` e `--repository`. Con identità e branch espliciti, ricerca e merge possono funzionare fuori da Git; creazione richiede comunque fetch, verifica dei branch e confronto dei commit. Il bootstrap carica lazy una configurazione con URL e progetto opzionale. `get-pr-urls` richiede il progetto globale o esplicito, senza discovery Git. Le prove in `test/cli/repository-bootstrap.test.ts` verificano risoluzione senza progetto globale, alias SSH configurato, selezione manuale senza inizializzare Git e obbligo del progetto per le ricerche su tutto il progetto.

`test/cli/repository-discovery.test.ts` collega CLI, `GitClient`, parser, resolver e `BitbucketClient` con Git nativo e HTTP simulato. Verifica checkout rinominati, sottodirectory tramite `-C`, worktree collegati, protocolli supportati, priorità del remote di fetch e riscritture `insteadOf`. Remote assenti, non riconosciuti o non associati al server devono fallire prima di leggere il token o iniziare HTTP; il ripristino della directory avviene anche dopo questi errori. `test/helpers/git-fixture.ts` condivide l'isolamento con le prove native del lettore Git: configurazioni globali e di sistema escluse, environment `GIT_*` ripulito, hook e template vuoti, percorsi sicuri limitati alla fixture. Il worktree usa un commit vuoto locale e `--no-checkout`; non richiede rete, identità o impostazioni Git personali.

`repository/remote-url.ts` espone `parseBitbucketRemoteUrl`, la funzione pura usata dal resolver per riconoscere l'identità dal remote. Il risultato `ParsedBitbucketRemote` in `remote-url-types.ts` contiene protocollo, hostname normalizzato in minuscolo, porta, context path, project key e slug del repository. Project key e slug mantengono la propria capitalizzazione. Il parser non esegue Git, non legge configurazioni e non accede alla rete.

Per HTTP e HTTPS riconosce la forma `[context]/scm/<project>/<repository>`; per SSH URI e sintassi SCP usa gli ultimi due segmenti, conservando l'eventuale prefisso. Supporta suffisso `.git` opzionale, uno slash finale, IPv6 e progetti personali `~utente`. Le porte HTTP/HTTPS predefinite sono normalizzate da `URL` e restituite come assenti; le altre porte esplicite sono numeri da 1 a 65535. In sintassi SCP il primo `:` separa l'host dal percorso, non indica una porta: per specificarla usare `ssh://`. Host alternativi e alias SSH sono soltanto analizzati, non risolti o associati al server HTTP.

Il parser scarta l'eventuale userinfo e non restituisce username o password. I segmenti sono decodificati una volta e validati prima della normalizzazione del percorso: vengono rifiutati segmenti vuoti, `.` e `..`, separatori codificati, whitespace, controlli, query, fragment, encoding malformato e formati locali o protocolli non supportati. Le forme senza utente che iniziano con una lettera e `:` vengono trattate come percorsi Windows, per evitare di interpretarli come host SCP. Gli errori sono `Error` con messaggio fisso, senza URL originale o causa nativa. Il riconoscimento della forma non prova che l'host sia Bitbucket: il controllo con il server configurato appartiene al resolver.

Con un solo branch posizionale, il source è quello corrente e il target è l'argomento. Con due branch entrambi sono espliciti. Source e target non possono coincidere; non interrogare Git quando sono già noti.

`get-pr-url` cerca una PR aperta nel repository e termina al primo risultato corrispondente. `get-pr-urls` cerca nei repository del progetto e filtra nome e slug con wildcard `*` e `?`, senza distinzione tra maiuscole e minuscole. Entrambi stampano solo URL; nessun risultato significa nessun output ed exit code di successo.

## Creazione PR

`create-pr` effettua fetch, verifica source e target remoti e legge il confronto `remote/target..remote/source`, senza usare branch locali per il contenuto. Esclude merge commit e ordina dal più vecchio al più recente tramite `--no-merges --reverse`.

`buildPullRequestContent(commits, sourceBranch)` è pura, accetta dati readonly e non modifica input né invoca Git. Con un solo commit usa il subject come titolo, altrimenti il source branch. La descrizione resta una lista Markdown anche per un solo commit, con il body annidato e `&nbsp;` fra i commit. Un confronto vuoto produce un errore che conserva i riferimenti source e target.

I reviewer configurati sono il default. `--reviewer` ripetibile o separato da virgole li sostituisce; `--no-reviewers` li disabilita. Le due opzioni sono incompatibili. La semantica Commander `options.reviewers === false` è mantenuta.

## Merge PR

`mergeOpenPullRequest` orchestra ricerca, rilettura, validazione, task opzionali, messaggio e merge. I moduli REST espongono operazioni su PR, suggerimento del messaggio e task; le regole pure risiedono in `pull-request/merge-validation.ts`. Non introdurre checkout, pull, merge locale, push o stash.

Il merge usa `POST .../pull-requests/{id}/merge` con versione corrente e rispetta i merge check del server. La risposta deve confermare `MERGED` per lo stesso ID richiesto. Una PR senza reviewer è ammessa; se sono presenti, ne serve almeno uno `APPROVED`. Qualunque `NEEDS_WORK` blocca il merge.

`--message-prefix` si applica al messaggio effettivo creato da Bitbucket: leggere il suggerimento, anteporre il prefisso e inviare il messaggio esplicito evitando un secondo subject automatico quando supportato.

Senza `--complete-tasks` i task non vengono modificati. Con l'opzione:

1. Validare stato, versione e reviewer della PR.
2. Raccogliere tutte le pagine dei task prima di aggiornarli, evitando spostamenti degli indici durante la paginazione.
3. Rileggere ciascun task da completare e usare la versione corrente.
4. Impostare a `RESOLVED` solo i task ancora aperti.
5. Rileggere la PR e ricontrollare branch, stato, versione e reviewer prima del merge.

Un errore o conflitto interrompe il flusso senza tentare il merge; i task già risolti restano risolti. L'opzione non disattiva reviewer o merge check e non giustifica retry che sovrascrivano modifiche concorrenti.

`--delete-source` viene passato dalla CLI a `MergeOpenPullRequestOptions` in `application/merge-pull-request-types.ts`. `BitbucketPullRequestRef.latestCommit` è opzionale nel modello generale e validato come stringa quando presente. Le regole pure di `merge-validation.ts` richiedono, solo per la cancellazione, un hash completo, un ref branch e un'identità source validi, diversi dal branch target. Questi prerequisiti vengono verificati prima di modificare i task e di nuovo sulla PR aggiornata prima del merge. La rilettura dopo i task deve conservare anche le identità dei repository source e target, oltre ai ref.

Dopo la risposta `MERGED`, il workflow confronta ref, repository e commit con la PR usata per il merge. Soltanto se corrispondono invoca DELETE sul repository di `fromRef`, usando il commit validato come `endPoint`. Non rilegge il branch per sostituire il commit atteso: il vincolo deve proteggere eventuali commit arrivati dopo lo snapshot. L'endpoint ufficiale [Delete branch](https://developer.atlassian.com/server/bitbucket/rest/v901/api-group-repository/) restituisce risposta vuota anche se il branch è già assente e rifiuta un commit diverso. Errori 404, permessi, protezioni, conflitti, timeout e risposte inattese restano fallimenti; nessun retry automatico.

`MergeOpenPullRequestResult` contiene la PR mergiata e lo stato `sourceDeletion`: `not-requested`, `deleted` oppure `failed`, con `Error` originale nel terzo caso. Errori prima della conferma del merge vengono propagati; dopo la conferma, errori o incoerenze della cancellazione producono un risultato parziale. Il workflow non stampa e non imposta exit code. Il registrar stampa l'URL quando disponibile, segnala su stderr che il merge è riuscito ma la cancellazione è fallita o non confermata e imposta exit code `1`. In caso di successo completo mantiene l'output composto dal solo URL. Nessun processo Git o modifica del branch locale viene introdotto per la cancellazione.

I test coprono trasporto DELETE con body e overload parser, endpoint branch-utils, metadati della PR, commit atteso, fork, protezioni, errori, timeout ed esiti parziali. `test:package` esegue anche il JavaScript installato per merge e cancellazione con risposte simulate: successo, cancellazione rifiutata, merge rifiutato e merge non confermato, verificando stdout, stderr, exit code e assenza di processi Git nel caso manuale.

## Build, distribuzione e verifica

Durante lo sviluppo Node esegue TypeScript direttamente. Il build con `tsconfig.build.json` genera il JavaScript di distribuzione; `prepare` lo avvia e il launcher npm punta a `dist/main.js`. Lo stesso lifecycle copre `npm pack`, l'installazione da Git e `npm install`/`npm ci` nel checkout. Non affiancare un secondo hook `prepack` che esegua nuovamente il build. Il pacchetto è privato e supporta la distribuzione tramite tarball o installazione diretta da GitHub; `dist/` rimane ignorata da Git.

L'allowlist del pacchetto comprende solo runtime JavaScript, manifest, README, contratto pubblico `docs/json-output.md` e Commander con licenza, incluso tramite `bundleDependencies`. `npm run test:package` verifica contenuti, installazione offline con cache vuota e dipendenze di produzione, launcher e configurazione fittizia. Entrambe le verifiche di installazione confrontano il contratto distribuito con quello del checkout. Prefisso e dati temporanei sono isolati e ripuliti, senza modificare l'installazione globale o la configurazione reale.

La verifica del pacchetto include help e rapporto di `doctor` installato, con token fittizio in `BB_TOKEN`, e controlla exit code `0` con avvisi e `1` con token vuoto. Verifica inoltre `--repository` e `--project-key` nell'help dei tre comandi PR, persistenza e azzeramento degli hostname SSH, e `get-pr-url` sul JavaScript installato senza progetto globale. La lettura Git è simulata per il remote SSH associato; la selezione manuale deve evitare ogni processo. Una GET simulata valida percorso REST, header e URL stampato. Non legge portachiavi personali né esegue verifiche remote. Le prove HTTP simulate coprono separatamente errori di connessione, timeout, accesso, parser e prerequisiti; le prove native del server aziendale restano esterne alla suite offline.

`npm run test:git` crea un repository Git locale temporaneo dai file necessari al build, senza artefatti compilati né dipendenze già installate. Lo installa tramite URL `git+file` con SHA esplicito, lasciando che npm scarichi le dipendenze ed esegua `prepare`, poi verifica il launcher e le dipendenze di produzione. Richiede accesso al registry e rimane separato dalla suite offline. La CI esegue anche questa prova su Windows, Linux e macOS.

L'installazione diretta da Git richiede npm >=12.2.1 con Node.js >=24.15.0: npm 11 propaga erroneamente la modalità globale durante la preparazione delle dipendenze Git ([npm/pacote#494](https://github.com/npm/pacote/pull/494)). Non aggiungere installazioni ricorsive nei lifecycle per compensare quel difetto: usare una versione npm corretta. Il test Git controlla il requisito e la CI lo avvia tramite `npm exec --yes --package=npm@12.2.1 -- npm run test:git`, senza modificare l'npm globale del runner. L'installazione del tarball e il runtime mantengono il requisito Node.js >=24.0.0.

La suite nativa Node seleziona `test/**/*.test.ts`; gli helper non vengono eseguiti come suite. I test usano dipendenze sostituibili e mantengono le verifiche integrate della CLI. La CI in [.github/workflows/ci.yml](../.github/workflows/ci.yml) esegue formattazione, typecheck, suite e pacchetto su Node 24 in Windows, Linux e macOS; abilita inoltre il round trip DPAPI isolato su Windows.

Il job `package` dipende dal successo dell'intera matrice `verify`. Su un checkout pulito Ubuntu installa le dipendenze con `npm ci` e genera `out/bb-<versione>.tgz` tramite `npm pack`, includendo build e Commander. `actions/upload-artifact` conserva soltanto i tarball per 30 giorni nell'artifact `bb-package-<commit SHA>`, senza eseguire `npm publish` o creare release. Il job usa gli stessi trigger della verifica, incluse Pull Request ed esecuzioni manuali.

La cache del package manager in `actions/setup-node` è disabilitata esplicitamente in entrambi i job. Il ripristino della cache npm ha bloccato un'esecuzione prima di `npm ci`, con download a zero byte ed errore del servizio `Egress is over the account limit`. Le dipendenze vengono installate dal lockfile tramite il registry; la generazione del pacchetto non dipende dal ripristino della cache GitHub Actions.

I backend macOS e Linux sono verificati tramite tool simulati e richiedono prove native nei rispettivi ambienti. Restano da verificare i flussi autenticati contro il server aziendale, compresi permessi e protezione dei commit nella cancellazione del source branch, e da scegliere il canale interno di release.
