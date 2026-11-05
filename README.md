# bb

CLI interna per Git e Bitbucket Data Center / Server, sviluppata in Node.js e TypeScript.

Il progetto implementa configurazione globale, pass-through Git, ricerca, creazione e merge delle Pull Request. Le API utilizzate sono quelle di Bitbucket Data Center, sotto `/rest/api/latest/` e `/rest/branch-utils/latest/` per la cancellazione condizionata dei branch.

## Requisiti e avvio

- Node.js 24 LTS o una versione successiva compatibile.
- npm.
- Git disponibile nel `PATH` per i comandi che lavorano sul repository locale.
- Per salvare il token: `powershell.exe` su Windows, Keychain su macOS, oppure `secret-tool` e una sessione Secret Service su Linux. In alternativa, `BB_TOKEN` permette l'autenticazione senza portachiavi.

Dalla directory di questo progetto:

```powershell
npm ci
node src/main.ts --help
node src/main.ts config init
```

Node esegue direttamente TypeScript: durante lo sviluppo non serve una fase di compilazione.

Gli esempi di sviluppo seguenti usano `node src/main.ts` dalla directory del progetto. Per eseguire i sorgenti da un'altra directory, indicare il percorso assoluto di `src/main.ts`. Dopo l'installazione del pacchetto si può usare direttamente `bb`.

## Packaging e installazione del comando bb

Il pacchetto richiede Node.js `>=24.0.0`. Per prepararlo da un checkout con le dipendenze installate:

```powershell
npm run typecheck
npm test
npm run test:package
npm pack
```

`npm pack` esegue automaticamente `prepare`, che avvia il build, e genera `bb-0.1.0.tgz` nella directory corrente. Il build pulisce `dist/`, compila solo `src/` tramite `tsconfig.build.json` e riscrive gli import `.ts` in `.js`. Non genera eseguibili `.exe`.

Questa compilazione serve alla distribuzione: [Node.js 24 non esegue il type stripping sotto `node_modules`](https://r2.nodejs.org/docs/v24.0.2/api/typescript.html). Lo sviluppo continua a usare TypeScript diretto e `npm start` non richiede il build.

Il lifecycle `prepare` esegue il build anche durante `npm install` e `npm ci` nel checkout. Le successive esecuzioni di `node src/main.ts ...` continuano a usare direttamente i sorgenti aggiornati.

L'archivio contiene il manifest, il README, i file JavaScript di `dist/` e Commander completo della sua licenza in `node_modules/commander/`, incluso tramite `bundleDependencies`. Sorgenti TypeScript dell'applicazione, test, configurazioni di sviluppo, token e dipendenze di sviluppo sono esclusi. Commander proviene dalle dipendenze installate nel checkout: eseguire `npm ci` prima di preparare il pacchetto da un nuovo checkout.

Il tarball può essere installato senza accesso al registry npm, anche con cache vuota. Sul computer di destinazione servono comunque Node.js e npm. Per imporre l'installazione offline aggiungere `--offline --no-audit --no-fund` al comando seguente.

Per installare il tarball:

```powershell
npm install --global "./bb-0.1.0.tgz" --omit=dev
bb --help
bb config init
bb -C "C:\work\payments" get-pr-url develop
```

Il campo `bin` espone `dist/main.js` come comando `bb`. npm crea il launcher adatto alla piattaforma. Controllare con `npm prefix --global` il prefisso di installazione: la directory del prefisso su Windows, oppure la sua sottodirectory `bin` su Linux e macOS, deve essere nel `PATH`.

Per aggiornare, installare il nuovo tarball con lo stesso comando `npm install --global`. Per disinstallare:

```powershell
npm uninstall --global bb
```

La distribuzione interna avviene tramite tarball. `private: true` mantiene il blocco alla pubblicazione con `npm publish`.

`npm run test:package` costruisce un archivio temporaneo, ne controlla i file e la presenza di Commander con la sua licenza, quindi lo installa offline con cache vuota, sole dipendenze di produzione e script di installazione disabilitati. Verifica il launcher da una directory esterna al checkout, l'help di `merge-pr`, lo stato del token tramite un valore fittizio in `BB_TOKEN` e una lettura della configurazione isolata. Il prefisso di prova e la cache temporanea vengono rimossi al termine; l'installazione globale dell'utente e la configurazione reale non vengono modificate.

Per generare solo i file di distribuzione, usare `npm run build`.

### Installazione direttamente da GitHub

Questa modalità richiede Node.js >=24.15.0, npm >=12.2.1 e Git nel `PATH`. Prima dell'installazione verificare `node --version` e `npm --version`; per aggiornare npm usare `npm install --global npm@12.2.1`.

```powershell
npm install --global --allow-git=all --allow-scripts=Tonio993/bb "github:Tonio993/bb#main"
bb --help
```

Per installare una revisione precisa, sostituire `main` con un tag o uno SHA di commit. Per aggiornare, rieseguire l'installazione indicando la revisione desiderata.

npm prepara il repository in una directory temporanea, installa le dipendenze necessarie al build ed esegue `prepare` prima di confezionare e installare il pacchetto. Non serve versionare `dist/`; l'installazione finale contiene JavaScript e Commander, senza i sorgenti TypeScript o gli strumenti di sviluppo. Il campo `private: true` continua a bloccare `npm publish` e consente l'installazione da Git.

Questa modalità richiede accesso a GitHub e al registry delle dipendenze e gli script npm abilitati: `--ignore-scripts` impedirebbe la generazione di `dist/`. L'opzione `--allow-git=all` abilita esplicitamente il recupero da Git, disabilitato per default in npm 12; `--allow-scripts=Tonio993/bb` consente il build da quel repository. Per un'installazione offline usare il tarball già compilato.

npm 11 presenta un [difetto nella preparazione delle dipendenze Git globali](https://github.com/npm/pacote/pull/494): può omettere gli strumenti di build e modificare la destinazione dell'installazione. Il requisito npm >=12.2.1 riguarda l'installazione da Git; runtime e installazione del tarball restano compatibili con Node.js >=24.0.0.

### Pacchetto generato dalla CI

Dopo il successo dei controlli su Windows, Linux e macOS, il workflow GitHub Actions esegue il job `Build installable package`: installa le dipendenze dal lockfile e genera il tarball tramite `npm pack`, che avvia automaticamente il build.

Per scaricarlo:

1. Aprire **Actions → CI** nel repository GitHub e selezionare un'esecuzione completata con successo.
2. Nella sezione **Artifacts**, scaricare `bb-package-<commit SHA>`.
3. Estrarre lo ZIP scaricato: contiene `bb-<versione>.tgz`, installabile su Windows, Linux e macOS con Node.js 24 o successivo compatibile.
4. Installare il tarball con `npm install --global "./bb-0.1.0.tgz" --omit=dev`, adattando il nome alla versione scaricata.

Gli artifact sono conservati per 30 giorni. La generazione avviene anche sulle Pull Request e nelle esecuzioni manuali, dopo il successo dell'intera matrice. Non viene eseguito `npm publish` e non viene creata una release GitHub.

## Diagnostica locale

```powershell
bb doctor
bb doctor --check-token
bb doctor --remote
```

Dal checkout usare `node src/main.ts doctor`. Il comando controlla la versione Node.js corrente, la versione npm disponibile nel `PATH`, la disponibilità di Git e il percorso e la validità della configurazione globale. Funziona anche fuori da un repository e prima di `config init`.

| Modalità                  | Legge e valida il token                | Contatta Bitbucket                    |
| ------------------------- | -------------------------------------- | ------------------------------------- |
| `bb doctor`               | No                                     | No                                    |
| `bb doctor --check-token` | Sì                                     | No                                    |
| `bb doctor --remote`      | Sì, se URL e backend sono utilizzabili | Una GET se i prerequisiti sono validi |

Le opzioni `--remote` e `--check-token` possono essere combinate; non provocano una seconda lettura del token persistente. Un `--check-token` esplicito permette la verifica locale della credenziale anche quando manca l'URL del server.

| Stato  | Significato                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------- |
| `OK`   | Il singolo controllo è riuscito nel proprio ambito.                                            |
| `WARN` | Configurazione incompleta o limite che non impedisce la modalità richiesta.                    |
| `FAIL` | Un controllo o un prerequisito necessario è fallito.                                           |
| `SKIP` | Controllo non richiesto o impossibile per un prerequisito fallito; non equivale a un successo. |

Il rapporto termina con una riga come `Summary: 6 OK, 1 WARN, 0 FAIL, 1 SKIP`. Tutte le righe del rapporto, anche quelle `FAIL`, sono su stdout. Gli errori di sintassi CLI restano su stderr. L'exit code complessivo è `1` se almeno un controllo è `FAIL`, altrimenti `0`: `WARN` e `SKIP` non causano da soli un errore. I numeri dipendono dall'ambiente e dalle opzioni. Un timeout prima di ricevere una risposta produce `FAIL` per la connessione e `SKIP` per l'autenticazione; un timeout del corpo dopo la risposta impedisce di confermare l'autenticazione.

Ogni controllo produce una riga con stato `OK`, `WARN`, `FAIL` o `SKIP` quando una verifica non viene eseguita. Una configurazione assente o incompleta produce un avviso con le chiavi mancanti; un file non leggibile o non valido produce un errore. La configurazione viene validata senza mostrarne i valori. npm precedente alla 12.2.1, oppure Node precedente alla 24.15.0 ma compatibile con il runtime, produce un avviso sui requisiti dell'installazione da Git; non impedisce l'uso del tarball.

Il comando mostra la sorgente prevista delle credenziali: `BB_TOKEN`, se definita, oppure il backend della piattaforma. Questa indicazione non conferma la presenza di un token. Per il backend verifica soltanto che il relativo eseguibile sia disponibile: `powershell.exe`, `/usr/bin/security` o `secret-tool`, senza avviarlo o leggere il portachiavi. Se `BB_TOKEN` è definita, il backend persistente e il suo tool vengono ignorati, anche quando il valore della variabile è vuoto o non valido.

`--check-token` richiede esplicitamente la lettura e la validazione locale della credenziale attiva. Può attivare una richiesta di accesso del sistema operativo. Il token non viene mostrato, salvato o modificato. Token assente, variabile non valida, tool necessario indisponibile o errore di accesso producono `FAIL`, con indicazioni correttive senza diagnostiche native. Senza l'opzione la lettura è `SKIP` e un tool mancante produce soltanto `WARN`. La disponibilità del tool non garantisce che il portachiavi sia sbloccato o che Secret Service sia attivo; la verifica di lettura usa i backend esistenti, con timeout dei processi nativi di 60 secondi.

`--remote` aggiunge una verifica di connessione e autenticazione sul server configurato e implica la lettura del token, con eventuale richiesta di accesso del sistema operativo. Esegue una sola GET a `/rest/api/latest/dashboard/pull-requests?limit=1&start=0`, una risorsa della dashboard dell'utente autenticato documentata nelle [API Data Center](https://developer.atlassian.com/server/bitbucket/rest/v819/api-group-dashboard/). Una pagina valida, anche vuota, conferma l'accesso autenticato alla dashboard; non conferma i permessi sui singoli progetti o repository. Non richiede una project key né un repository locale. Token di progetto o repository e restrizioni aziendali possono impedire l'accesso alla dashboard: un rifiuto non prova da solo che il token sia scaduto.

La verifica remota ha un timeout di 10 secondi, inclusa la lettura della risposta, non segue redirect e non esegue retry. Distingue errori di connessione, timeout, HTTP 401, accesso negato 403, endpoint non trovato e problemi del server. Un 401 può dipendere da credenziali o permessi; un 403 non conferma da solo l'identità autenticata. Risposte HTML o JSON inattese indicano una possibile configurazione errata di URL, context path, proxy o SSO. Non vengono stampati token, dati delle PR o contenuti delle risposte di errore. URL mancante o non valido e credenziali non utilizzabili impediscono la richiesta; senza URL il token non viene letto, salvo un `--check-token` esplicito. Un token persistente validato viene riutilizzato in memoria per la richiesta e rimosso dalla cache al termine.

I controlli proseguono anche dopo un errore. L'exit code è `1` se almeno un controllo è `FAIL`, altrimenti `0`, anche in presenza di avvisi. Le verifiche di npm e Git hanno ciascuna un timeout di 10 secondi. Il comando non modifica configurazione o dipendenze; senza `--remote` non effettua richieste a Bitbucket e non verifica l'autenticazione sul server. Non contatta il registry. Il comportamento dell'endpoint con la versione e le policy del server aziendale resta da verificare dal vivo; la suite automatica usa risposte simulate.

Per i problemi più comuni:

| Segnalazione                           | Intervento                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Configurazione assente o incompleta    | Eseguire `bb config init`; per un file non valido controllare accesso, JSON e valori nel percorso riportato. |
| npm precedente alla 12.2.1             | Con Node compatibile, eseguire `npm install --global npm@12.2.1`; altrimenti aggiornare prima Node.          |
| Token assente o `BB_TOKEN` non valida  | Eseguire `bb token set` oppure correggere la variabile; rimuovere `BB_TOKEN` per usare il token persistente. |
| Errore DPAPI                           | Verificare `powershell.exe` e usare l'account Windows che possiede il token.                                 |
| Errore Keychain                        | Sbloccare il portachiavi di login e consentire l'accesso.                                                    |
| Errore Secret Service                  | Installare `secret-tool` di libsecret e sbloccare una sessione Secret Service.                               |
| HTTP 401 o 403                         | Verificare validità, ambito e permessi del token, oltre alle restrizioni dell'account.                       |
| Redirect, HTTP 404 o risposta inattesa | Verificare `bitbucket.url`, context path, proxy, SSO e compatibilità del server.                             |
| Connessione fallita o timeout          | Verificare rete, DNS, proxy, certificati TLS e disponibilità del server.                                     |
| HTTP 429                               | Attendere prima di ripetere il comando; non viene effettuato un retry automatico.                            |

## Configurazione globale

`config init` chiede un valore alla volta. Mostra i valori esistenti come default e li mantiene premendo Invio. La project key è opzionale: lasciarla vuota per ricavarla dal remote nei comandi sul repository corrente. Non richiede una configurazione già completa né un token; conserva gli hostname SSH già configurati.

Per leggere, elencare o modificare le impostazioni:

```powershell
node src/main.ts config
node src/main.ts config list
node src/main.ts config bitbucket.url
node src/main.ts config bitbucket.url "https://bitbucket.company.com"
node src/main.ts config bitbucket.projectKey "PROJECT"
node src/main.ts config bitbucket.defaultReviewers "mrossi,lbianchi"
node src/main.ts config bitbucket.sshHostnames "ssh.bitbucket.company.com,bb-internal"
node src/main.ts config git.remote "origin"
```

| Impostazione                 | Obbligatoria | Valore predefinito          |
| ---------------------------- | ------------ | --------------------------- |
| `bitbucket.url`              | Sì           | Nessuno                     |
| `bitbucket.projectKey`       | No           | Nessuno                     |
| `bitbucket.defaultReviewers` | No           | Nessun reviewer             |
| `bitbucket.sshHostnames`     | No           | Nessun hostname alternativo |
| `git.remote`                 | No           | `origin`                    |

`bitbucket.url` può includere il context path del server, ad esempio `https://bitbucket.company.com/bitbucket`.

`bitbucket.projectKey` è un default per `get-pr-urls` e per la selezione manuale di un repository. `get-pr-urls` richiede il progetto configurato o `--project-key`; i comandi sul repository corrente possono ricavarlo dal remote.

`bitbucket.sshHostnames` associa esplicitamente gli hostname SSH alternativi al server di `bitbucket.url`. Accetta una lista separata da virgole di hostname o IPv6 tra parentesi quadre, senza porte, percorsi, userinfo o wildcard. Un valore vuoto svuota la lista. In `config.json` il valore è un array di stringhe. L'associazione non cambia la connessione Git né le impostazioni SSH.

Il file di configurazione risiede fuori dai repository:

| Sistema | Percorso                                                                       |
| ------- | ------------------------------------------------------------------------------ |
| Windows | `%APPDATA%\bb\config.json`, con fallback su `~/AppData/Roaming/bb/config.json` |
| Linux   | `$XDG_CONFIG_HOME/bb/config.json`, oppure `~/.config/bb/config.json`           |
| macOS   | `~/Library/Application Support/bb/config.json`                                 |

`config list` mostra il percorso effettivo. La configurazione obbligatoria viene validata quando un comando Bitbucket la usa; l'help e i comandi `config` rimangono disponibili senza di essa. Un file JSON illeggibile o con campi di tipo errato produce un errore che identifica il file e il problema.

Lettura, scrittura e inizializzazione applicano le stesse regole di normalizzazione: spazi esterni rimossi, reviewer vuoti esclusi e URL con host normalizzato e senza slash finali. L'URL deve essere assoluto HTTP/HTTPS e non deve contenere credenziali, wildcard nell'host, query o fragment; il context path è supportato. Le stringhe presenti non possono essere vuote; i valori opzionali mancanti mantengono i default indicati nella tabella.

`config` e `config list` mostrano i valori da una sola lettura del file; anche i default di `config init` provengono da una singola snapshot. I salvataggi usano un file temporaneo nella stessa directory e sostituiscono il JSON soltanto dopo aver completato la scrittura. Un errore durante scrittura o sostituzione lascia intatto il file precedente. Gli aggiornamenti di singole chiavi conservano eventuali campi aggiuntivi.

## Token Bitbucket

Il token è separato da `config.json`. Per impostarlo, controllarne la provenienza o cancellare quello salvato:

```powershell
bb token set
bb token status
bb token delete
```

Dal checkout usare, ad esempio, `node src/main.ts token set`. Questi comandi funzionano anche prima di `config init`.

`token set` chiede il token senza visualizzarlo, senza inserirlo nella history del prompt e ripristinando il terminale anche con Ctrl+C o EOF. Non accetta il token come argomento della command line. Per ricevere il valore da un secret manager tramite una pipe, usare `bb token set --stdin`.

| Piattaforma | Memorizzazione                                                                   | Requisiti                                                                        |
| ----------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Windows     | DPAPI, `%APPDATA%\bb\token.dat` con fallback sulla directory roaming del profilo | `powershell.exe` e lo stesso account Windows che possiede il token               |
| macOS       | Keychain, servizio `bb.bitbucket`, account `token`                               | `/usr/bin/security` e accesso al portachiavi dell'utente                         |
| Linux       | Secret Service, attributi `service=bb.bitbucket` e `account=token`               | `secret-tool` di libsecret e una sessione Secret Service disponibile e sbloccata |

Su Windows il token viene cifrato con DPAPI e può essere letto soltanto dallo stesso account Windows. I comandi `token set` e `token delete` gestiscono il file `token.dat` indicato nella tabella.

Su Linux installare `secret-tool` tramite il gestore pacchetti della distribuzione e usare un servizio compatibile, ad esempio GNOME Keyring. Per CI, container, SSH o sessioni senza portachiavi, fornire la variabile `BB_TOKEN` tramite il secret manager dell'ambiente.

`BB_TOKEN` ha precedenza sul token salvato su tutte le piattaforme. Non viene persistita dalla CLI. `token set` e `token delete` modificano soltanto la memorizzazione persistente: finché `BB_TOKEN` è definita, rimane la credenziale attiva. `token status` stampa solo la sorgente (`BB_TOKEN` o il nome del backend), senza mostrare il valore; restituisce exit code `1` se nessun token è configurato.

I token non possono essere vuoti, contenere whitespace o caratteri di controllo, oppure superare 1024 byte. L'input da stdin può terminare con un newline. I secret vengono passati ai tool nativi attraverso stdin, mai come argomenti; le diagnostiche native vengono sostituite da messaggi che non espongono il token. Se il portachiavi è assente, bloccato o non accessibile, il comando mostra come correggere il problema o usare `BB_TOKEN`; non salva un file in chiaro come ripiego.

Il token persistente viene letto solo alla prima operazione autenticata e riutilizzato in memoria durante l'esecuzione. La cache è condivisa dai client Git e Bitbucket e viene svuotata al termine. Help, configurazione e operazioni Git locali non richiedono accesso al portachiavi.

## Repository, directory e branch

Per `get-pr-url`, `create-pr` e `merge-pr`, project key e slug del repository vengono ricavati dall'URL di fetch di `git.remote` (default `origin`). `--project-key` prevale sul progetto del remote; il progetto globale non sostituisce quello riconosciuto automaticamente. Il nome della directory locale può essere diverso dallo slug. La lettura del remote è locale, applica le riscritture Git `insteadOf` e non richiede token o rete.

Per HTTP(S) il remote deve corrispondere a protocollo, hostname, porta e context path di `bitbucket.url`. Per SSH, anche in sintassi SCP, deve avere lo stesso hostname del server configurato oppure comparire in `bitbucket.sshHostnames`; porta e percorso SSH possono essere diversi da quelli HTTP. Un remote assente, non riconosciuto o appartenente a un altro server produce un errore, senza ripiegare sul nome della directory. Le associazioni SSH non autorizzano remote HTTP(S) di altri server.

`--repository <slug>` seleziona manualmente il repository per `get-pr-url`, `create-pr` e `merge-pr`. Con un repository manuale si usa `--project-key` oppure il progetto globale; se manca anche questo, si ricava il progetto dal remote. Quando progetto e repository sono già disponibili, la discovery del remote viene saltata. Specificando anche entrambi i branch, `get-pr-url` e `merge-pr` funzionano fuori da un checkout senza inizializzare Git. `create-pr` continua a richiedere Git per fetch, branch remoti e contenuto della PR. `get-pr-urls` usa il progetto configurato o `--project-key`, senza interrogare Git.

```powershell
bb get-pr-url feature/ABC-123 develop --project-key PROJECT --repository payments
bb merge-pr feature/ABC-123 develop --project-key PROJECT --repository payments
bb config bitbucket.sshHostnames "ssh.bitbucket.company.com"
```

Le precedenze dipendono dai dati disponibili:

| Input                                 | Progetto   | Repository | Lettura del remote |
| ------------------------------------- | ---------- | ---------- | ------------------ |
| Nessun override                       | Dal remote | Dal remote | Sì                 |
| Solo `--project-key`                  | Esplicito  | Dal remote | Sì                 |
| `--repository` e progetto globale     | Globale    | Esplicito  | No                 |
| `--repository` senza progetto globale | Dal remote | Esplicito  | Sì                 |
| `--project-key` e `--repository`      | Esplicito  | Esplicito  | No                 |

Un checkout con più remote usa soltanto il primo URL di fetch di `git.remote`; gli URL di push non determinano l'identità. Il riconoscimento funziona nelle sottodirectory e nei worktree collegati. La project key globale resta utile alle ricerche su tutto il progetto e agli override manuali; non corregge un remote non riconosciuto. URL locali, protocolli diversi da HTTP(S)/SSH e forme clone non standard richiedono una selezione manuale.

L'opzione globale `-C` / `--path`, prima del comando, cambia la directory per la durata dell'operazione e la ripristina anche in caso di errore:

```powershell
node src/main.ts -C "C:\work\payments" get-pr-url develop
node src/main.ts --path "C:\work\payments" merge-pr develop
```

Per `get-pr-url`, `create-pr` e `merge-pr`:

- un solo branch posizionale indica il target e usa il branch corrente come source;
- due branch posizionali indicano, nell'ordine, source e target;
- `--target-branch` può usare il branch corrente come source;
- `--source-branch` richiede anche `--target-branch`;
- argomenti posizionali e opzioni nominate dei branch non si possono combinare;
- source e target devono essere diversi.

Quando entrambi i branch sono specificati, la CLI evita di interrogare il branch corrente.

Per verificare il riconoscimento sul server aziendale usare una PR aperta nota e `get-pr-url`, che esegue soltanto letture. Dal checkout, anche se rinominato, eseguire `bb -C "<checkout o sottodirectory>" get-pr-url <source> <target>` e confrontare l'URL con quello della PR. Ripetere da una directory esterna al checkout con `bb get-pr-url <source> <target> --project-key <progetto> --repository <slug>`: l'URL deve coincidere. Per clone SSH con hostname differente configurare prima l'associazione in `bitbucket.sshHostnames`. I placeholder vanno sostituiti con i valori reali; nessun risultato produce output vuoto con exit code `0`, mentre un errore di remote, configurazione o API produce exit code `1`. `doctor --remote` verifica l'accesso alla dashboard, ma non verifica questa risoluzione né i permessi sul repository scelto.

## Comandi

| Comando                         | Risultato                                              |
| ------------------------------- | ------------------------------------------------------ |
| `config [key] [value]`          | Elenca, legge o modifica la configurazione             |
| `doctor`                        | Controlla strumenti locali e configurazione            |
| `config list`                   | Elenca impostazioni e percorso del file                |
| `config init`                   | Configura le impostazioni in modo interattivo          |
| `token set [--stdin]`           | Salva il token con input nascosto o da una pipe        |
| `token [status]`                | Mostra la sorgente della credenziale attiva            |
| `token delete`                  | Elimina il token persistente                           |
| `git <args...>`                 | Inoltra gli argomenti a Git                            |
| `get-pr-url [source] [target]`  | Cerca una PR aperta nel repository corrente            |
| `get-pr-urls <source> <target>` | Cerca PR aperte attraverso i repository di un progetto |
| `create-pr [source] [target]`   | Crea una PR usando i commit remoti                     |
| `merge-pr [source] [target]`    | Esegue il merge di una PR tramite REST                 |

Usare `--help` sul comando per consultarne opzioni e sintassi, ad esempio:

```powershell
node src/main.ts config init --help
node src/main.ts create-pr --help
node src/main.ts merge-pr --help
```

### Git

```powershell
node src/main.ts git status
node src/main.ts git log --oneline -10
node src/main.ts git fetch origin
node src/main.ts git -C "C:\work\payments" status
```

Gli argomenti dopo `git` vengono inoltrati al processo Git. In particolare, `git -C` è un'opzione di Git e non cambia la directory del processo `bb`. È possibile combinarla con l'opzione globale `-C`.

Il token Bitbucket viene aggiunto automaticamente per i comandi diretti `fetch`, `pull`, `push`, `clone` e `ls-remote`. Comandi locali come `status`, `log` e `branch` non richiedono token né `bitbucket.url`. Il token passa nell'environment temporaneo del processo figlio tramite `GIT_CONFIG_*`; non viene inserito nella command line. L'header usa `http.<url>.extraHeader`, limitato all'URL e al context path di `bitbucket.url`, e non viene applicato a server o percorsi esterni. Le operazioni remote richiedono quindi `bitbucket.url`, ma non `bitbucket.projectKey`. L'autenticazione nativa di Git rimane disponibile per gli altri server.

Le impostazioni `GIT_CONFIG_*` attive ereditate vengono preservate. Un `GIT_CONFIG_COUNT` non valido interrompe l'aggiunta delle credenziali con un errore esplicito. Le operazioni interne acquisiscono al massimo 16 MiB di output per comando e segnalano il superamento del limite; il pass-through mantiene stdout, stderr e stdin del terminale. I controlli dei branch distinguono l'assenza del riferimento dagli errori Git. Le terminazioni tramite segnale producono un errore esplicito.

Il riconoscimento automatico non espande gli alias Git e non copre altri sottocomandi remoti, come `remote update` o `submodule update`. In questi casi rimane disponibile l'autenticazione gestita direttamente da Git.

### Ricerca di Pull Request

```powershell
node src/main.ts -C "C:\work\payments" get-pr-url develop
node src/main.ts -C "C:\work\payments" get-pr-url feature/ABC-123 develop
node src/main.ts -C "C:\work\payments" get-pr-url --target-branch develop
node src/main.ts get-pr-urls feature/ABC-123 develop --project-key PROJECT
node src/main.ts get-pr-urls feature/ABC-123 develop --repository-filter "service-*"
node src/main.ts get-pr-urls feature/ABC-123 develop --repository-filter "*payment?*"
```

`get-pr-url` stampa soltanto l'URL della PR trovata. `get-pr-urls` stampa gli URL corrispondenti, uno per riga. Entrambi terminano con successo e senza output quando non trovano corrispondenze.

`get-pr-urls` richiede entrambi i branch e non interroga Git. Il filtro confronta sia `name` sia `slug`, senza distinzione tra maiuscole e minuscole: `*` corrisponde a zero o più caratteri e `?` a un carattere. La ricerca gestisce la paginazione di repository e PR.

### Creazione di Pull Request

```powershell
node src/main.ts -C "C:\work\payments" create-pr develop
node src/main.ts -C "C:\work\payments" create-pr feature/ABC-123 develop --title "Custom title"
node src/main.ts -C "C:\work\payments" create-pr --source-branch feature/ABC-123 --target-branch develop
node src/main.ts -C "C:\work\payments" create-pr develop --reviewer mario --reviewer luca
node src/main.ts -C "C:\work\payments" create-pr develop --reviewer "mario,luca"
node src/main.ts -C "C:\work\payments" create-pr develop --no-reviewers
```

Prima della creazione, la CLI esegue il fetch del remote configurato e verifica la presenza dei branch source e target remoti. Titolo e descrizione derivano da `refs/remotes/<remote>/<target>..refs/remotes/<remote>/<source>`, escludendo i merge commit e ordinando dal più vecchio al più recente.

Con un solo commit, il titolo è il suo subject; con più commit, è il nome del branch source. `--title` permette un override. La descrizione rimane una lista markdown anche con un solo commit; le righe del body diventano elementi annidati e i commit sono separati da `&nbsp;`. Se non ci sono commit non-merge, la creazione viene interrotta.

Senza opzioni vengono usati i reviewer configurati. `--reviewer` sostituisce i default e accetta valori ripetuti o separati da virgole. `--no-reviewers` li disabilita e non può essere combinato con `--reviewer`.

In caso di successo viene stampato soltanto l'URL della PR creata.

### Merge di Pull Request

```powershell
node src/main.ts -C "C:\work\payments" merge-pr develop
node src/main.ts -C "C:\work\payments" merge-pr feature/ABC-123 develop
node src/main.ts -C "C:\work\payments" merge-pr develop --message-prefix "[RELEASE] "
node src/main.ts -C "C:\work\payments" merge-pr develop --complete-tasks
node src/main.ts -C "C:\work\payments" merge-pr develop --delete-source
node src/main.ts merge-pr feature/ABC-123 develop --project-key PROJECT --repository payments --delete-source
```

Il comando cerca la PR aperta e ne rilegge i dettagli aggiornati. Una PR senza reviewer può essere mergiata; con reviewer presenti serve almeno uno stato `APPROVED` e nessuno stato `NEEDS_WORK`.

Il merge viene richiesto tramite REST con la versione corrente della PR. Bitbucket applica i merge check del repository e rileva i conflitti. La CLI non esegue checkout, stash, merge locale o push. Se la PR non esiste, il comando termina con errore.

`--message-prefix` recupera il messaggio di merge suggerito da Bitbucket, antepone il prefisso preservandone gli spazi e invia `autoSubject: false`. Senza prefisso, lascia al server la generazione del messaggio. Se il suggerimento richiesto non è disponibile, il merge viene interrotto.

`--complete-tasks` completa i task ancora aperti prima del merge. Legge tutte le pagine, recupera la versione aggiornata di ciascun task da modificare e ne imposta lo stato a `RESOLVED`. Poi rilegge la PR e ricontrolla branch, reviewer, stato e versione. L'opzione mantiene attivi i controlli sui reviewer e i merge check del server.

Se il completamento di un task o un passaggio successivo fallisce, i task già completati restano tali. Gli errori di permessi o di versione interrompono l'operazione.

`--delete-source` richiede la cancellazione del branch remoto source soltanto dopo che Bitbucket ha confermato lo stato `MERGED`. Usa il ref completo e il repository di `fromRef` della PR, anche per un fork, tramite `/rest/branch-utils/latest/`. Il branch locale resta disponibile; con identità e branch espliciti il comando continua a funzionare fuori da un checkout.

Prima del merge la CLI richiede un hash completo `fromRef.latestCommit`, ricavato dalla PR aggiornata; se il dato manca o non è valido, il merge viene interrotto. Dopo il merge controlla che ref, repository e commit corrispondano alla PR validata, poi invia l'hash come `endPoint` con `dryRun: false`. L'API rifiuta la cancellazione se il branch punta a un commit diverso, proteggendo eventuali aggiornamenti concorrenti. Un branch già assente è considerato cancellato quando il server conferma l'operazione con risposta vuota. Restano attivi i permessi e le protezioni dei branch. Il comportamento dell'endpoint e del controllo `endPoint` è descritto nelle [API Data Center](https://developer.atlassian.com/server/bitbucket/rest/v901/api-group-repository/).

L'opzione è combinabile con `--complete-tasks` e `--message-prefix`: task e messaggio vengono gestiti prima del merge, la cancellazione dopo. Senza `--delete-source` il comando non invia richieste di cancellazione. Non vengono effettuati retry automatici.

| Esito                                                   | stdout                 | stderr                   | Exit code |
| ------------------------------------------------------- | ---------------------- | ------------------------ | --------- |
| Merge riuscito e cancellazione confermata, se richiesta | URL PR                 | Vuoto                    | `0`       |
| Merge fallito o non confermato                          | Vuoto                  | Errore                   | `1`       |
| Merge riuscito, cancellazione fallita o non confermata  | URL PR, se disponibile | Esito parziale esplicito | `1`       |

Un errore della cancellazione non annulla il merge. In caso di esito parziale verificare lo stato del branch sul server prima di ripetere la sola cancellazione; un timeout può essere avvenuto dopo la sua rimozione. Un errore HTTP 404 non viene interpretato automaticamente come branch assente, perché può indicare un endpoint o un repository non accessibile. La compatibilità con versione, permessi e policy del server aziendale richiede una prova dedicata su una PR e un branch di test.

In caso di successo viene stampato soltanto l'URL della PR mergiata.

## Output ed errori

L'help esplicito termina con exit code `0`. Gli errori di parsing o applicativi terminano con exit code `1` e un messaggio su stderr. L'invocazione senza comando mostra l'help su stderr con exit code `1`.

Il pass-through `git` propaga l'exit code del processo Git. Le PR non trovate dai comandi di ricerca producono un risultato vuoto con exit code `0`; `merge-pr` richiede invece una PR esistente.

La CLI ripristina la directory e svuota la cache del token anche nei percorsi di help ed errore. Le paginazioni con indici mancanti, non interi o che non avanzano vengono interrotte con errore.

Ogni richiesta REST Bitbucket ha un timeout di 60 secondi, che copre anche la lettura del corpo della risposta. Il limite riguarda la singola richiesta, non l'intero comando. Gli errori conservano metodo, percorso e status HTTP quando disponibile. Non vengono eseguiti retry automatici: dopo un timeout durante creazione, merge, cancellazione di un branch o aggiornamento di un task, verificare lo stato sul server prima di ripetere l'operazione.

Le risposte di successo devono contenere JSON valido, salvo i corpi vuoti consentiti dalle singole operazioni. I moduli REST verificano struttura delle pagine, repository, PR, reviewer, task e suggerimenti del messaggio di merge prima di utilizzarli. Una pagina HTML di login o una risposta incompleta produce un errore esplicito anziché un errore di accesso ai campi. Gli errori di JSON malformato non mostrano il contenuto ricevuto. Una risposta non valida dopo una scrittura non implica che il server abbia annullato l'operazione.

## Sviluppo e verifica

```powershell
npm run format:check
npm run typecheck
npm test
```

I test usano il runner nativo Node, client sostituibili e risposte HTTP simulate. Non richiedono un server Bitbucket, un token reale o operazioni Git remote. Alcuni test eseguono subprocess Node per verificare la CLI e usano configurazioni temporanee isolate.

Le prove di discovery eseguono Git reale in repository temporanei, escludendo configurazioni e hook personali: checkout rinominati, sottodirectory, worktree, HTTP(S), SSH/SCP, remote configurato, più URL, `insteadOf` e rifiuto prima dell'accesso alle credenziali. L'HTTP rimane simulato. Per eseguirle usare `node --test "test/cli/repository-discovery.test.ts" "test/git/git-remote-url.test.ts"`.

I comandi dipendono da contratti strutturali ottenuti con `Pick`, così i test possono fornire semplici oggetti con i metodi necessari. I test di `BitbucketClient` iniettano `fetch` nelle opzioni del costruttore; quelli di `GitClient` iniettano `execute` nel quarto argomento opzionale, senza sostituire le funzioni globali di rete o processo. In esecuzione normale i client usano le API native Node. `npm test` seleziona `test/**/*.test.ts` ed esclude gli helper condivisi dalla scoperta delle suite.

La verifica del pacchetto installabile è separata e si avvia con `npm run test:package`. Include help delle opzioni repository e `--delete-source`, lettura e scrittura della configurazione SSH e ricerca PR sul JavaScript installato senza progetto globale, sia da remote simulato sia con identità manuale fuori dal checkout. Verifica inoltre merge e cancellazione del source di un fork, con successo completo, esito parziale, merge rifiutato e merge non confermato, controllando ordine delle richieste, output ed exit code. Non contatta Bitbucket né usa portachiavi personali.

`npm run test:git` verifica l'installazione da un repository Git temporaneo senza `dist/` né `node_modules/`, usando un prefisso isolato. La prova richiede npm >=12.2.1, scarica le dipendenze di build dal registry npm, verifica il launcher e l'assenza delle dipendenze di sviluppo nel pacchetto installato. È separata dalla suite offline e viene eseguita nella matrice CI su tutte e tre le piattaforme. Per eseguirla con la versione npm fissata dalla CI senza aggiornare l'installazione globale usare `npm exec --yes --package=npm@12.2.1 -- npm run test:git`.

`npm run check` esegue insieme controllo della formattazione, typecheck e suite offline. Per applicare lo stile comune a sorgenti, test, script e documentazione usare `npm run format`. Prettier è una dipendenza di sviluppo con versione fissata; `.editorconfig` e `.gitattributes` uniformano indentazione e terminatori LF tra le piattaforme.

Il workflow [CI](.github/workflows/ci.yml) parte sulle Pull Request, sui push a `main` e manualmente da GitHub Actions. Ogni job di verifica usa Node 24 e `npm ci`, poi verifica formattazione, tipi, test offline e pacchetto installato su Windows, Linux e macOS. Il job Windows esegue anche il round trip DPAPI con un token fittizio in storage temporaneo. Dopo il successo della matrice, un job separato genera il tarball scaricabile dagli artifact. Non occorrono secret Bitbucket e non viene eseguito `npm publish`. Le prove native Keychain e Secret Service restano manuali nei rispettivi ambienti.

I test di `TokenStore` usano backend fittizi per verificare precedenza delle credenziali, validazione e cache. I backend macOS e Linux e gli errori dei tool nativi sono verificati tramite un esecutore simulato, senza sostituire funzioni globali di Node. Il test reale DPAPI su Windows è opzionale, usa una directory temporanea e un token fittizio e può essere abilitato così:

```powershell
$env:BB_TEST_NATIVE_TOKEN_STORE = "1"
node --test test/auth/token-backends.test.ts
Remove-Item Env:BB_TEST_NATIVE_TOKEN_STORE
```

Le regole di lavoro sono in [AGENTS.md](AGENTS.md); responsabilità dei moduli e invarianti sono descritte in [docs/architecture.md](docs/architecture.md).

La [mappa dei file](docs/architecture.md#mappa-dei-file) mostra la struttura completa. La diagnostica applicativa di doctor è raccolta in `src/application/doctor/`, con test corrispondenti in `test/application/doctor/`; i test del bootstrap sono separati in `test/cli/doctor-bootstrap.test.ts`. I comandi sono in `src/cli/commands/`, le regole pure in `src/pull-request/` e i test seguono le stesse aree di `src/`. Schema, validazione e persistenza della configurazione hanno moduli distinti; i backend nativi del token sono raccolti in `src/auth/backends/`.

## Attività rimanenti

- Distribuire il tarball validato attraverso il canale interno scelto per le release.
- Verificare i flussi autenticati contro il server Bitbucket aziendale: le verifiche automatizzate attuali sono offline.
- Verificare dal vivo Keychain e Secret Service nei rispettivi ambienti di destinazione; la loro copertura automatizzata attuale usa tool simulati.
