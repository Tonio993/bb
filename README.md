# bb

CLI interna per Git e Bitbucket Data Center / Server, sviluppata in Node.js e TypeScript.

Il progetto implementa configurazione globale, pass-through Git, ricerca, creazione e merge delle Pull Request. Le API utilizzate sono quelle di Bitbucket Data Center, sotto `/rest/api/latest/`.

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

`npm pack` esegue automaticamente `prepack`, che avvia il build, e genera `bb-0.1.0.tgz` nella directory corrente. Il build pulisce `dist/`, compila solo `src/` tramite `tsconfig.build.json` e riscrive gli import `.ts` in `.js`. Non genera eseguibili `.exe`.

Questa compilazione serve alla distribuzione: [Node.js 24 non esegue il type stripping sotto `node_modules`](https://r2.nodejs.org/docs/v24.0.2/api/typescript.html). Lo sviluppo continua a usare TypeScript diretto e `npm start` non richiede il build.

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

## Configurazione globale

`config init` chiede un valore alla volta. Mostra i valori esistenti come default e li mantiene premendo Invio. Non richiede una configurazione già completa né un token.

Per leggere, elencare o modificare le impostazioni:

```powershell
node src/main.ts config
node src/main.ts config list
node src/main.ts config bitbucket.url
node src/main.ts config bitbucket.url "https://bitbucket.company.com"
node src/main.ts config bitbucket.projectKey "PROJECT"
node src/main.ts config bitbucket.defaultReviewers "mrossi,lbianchi"
node src/main.ts config git.remote "origin"
```

| Impostazione | Obbligatoria | Valore predefinito |
| --- | --- | --- |
| `bitbucket.url` | Sì | Nessuno |
| `bitbucket.projectKey` | Sì | Nessuno |
| `bitbucket.defaultReviewers` | No | Nessun reviewer |
| `git.remote` | No | `origin` |

`bitbucket.url` può includere il context path del server, ad esempio `https://bitbucket.company.com/bitbucket`.

Il file di configurazione risiede fuori dai repository:

| Sistema | Percorso |
| --- | --- |
| Windows | `%APPDATA%\bb\config.json`, con fallback su `~/AppData/Roaming/bb/config.json` |
| Linux | `$XDG_CONFIG_HOME/bb/config.json`, oppure `~/.config/bb/config.json` |
| macOS | `~/Library/Application Support/bb/config.json` |

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

| Piattaforma | Memorizzazione | Requisiti |
| --- | --- | --- |
| Windows | DPAPI, `%APPDATA%\bb\token.dat` con fallback sulla directory roaming del profilo | `powershell.exe` e lo stesso account Windows che possiede il token |
| macOS | Keychain, servizio `bb.bitbucket`, account `token` | `/usr/bin/security` e accesso al portachiavi dell'utente |
| Linux | Secret Service, attributi `service=bb.bitbucket` e `account=token` | `secret-tool` di libsecret e una sessione Secret Service disponibile e sbloccata |

Su Windows il token viene cifrato con DPAPI e può essere letto soltanto dallo stesso account Windows. I comandi `token set` e `token delete` gestiscono il file `token.dat` indicato nella tabella.

Su Linux installare `secret-tool` tramite il gestore pacchetti della distribuzione e usare un servizio compatibile, ad esempio GNOME Keyring. Per CI, container, SSH o sessioni senza portachiavi, fornire la variabile `BB_TOKEN` tramite il secret manager dell'ambiente.

`BB_TOKEN` ha precedenza sul token salvato su tutte le piattaforme. Non viene persistita dalla CLI. `token set` e `token delete` modificano soltanto la memorizzazione persistente: finché `BB_TOKEN` è definita, rimane la credenziale attiva. `token status` stampa solo la sorgente (`BB_TOKEN` o il nome del backend), senza mostrare il valore; restituisce exit code `1` se nessun token è configurato.

I token non possono essere vuoti, contenere whitespace o caratteri di controllo, oppure superare 1024 byte. L'input da stdin può terminare con un newline. I secret vengono passati ai tool nativi attraverso stdin, mai come argomenti; le diagnostiche native vengono sostituite da messaggi che non espongono il token. Se il portachiavi è assente, bloccato o non accessibile, il comando mostra come correggere il problema o usare `BB_TOKEN`; non salva un file in chiaro come ripiego.

Il token persistente viene letto solo alla prima operazione autenticata e riutilizzato in memoria durante l'esecuzione. La cache è condivisa dai client Git e Bitbucket e viene svuotata al termine. Help, configurazione e operazioni Git locali non richiedono accesso al portachiavi.

## Repository, directory e branch

La project key viene dalla configurazione oppure dall'override `--project-key`. Il repository viene identificato dal nome della directory radice restituita da Git: tale nome deve corrispondere allo slug del repository Bitbucket.

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

## Comandi

| Comando | Risultato |
| --- | --- |
| `config [key] [value]` | Elenca, legge o modifica la configurazione |
| `config list` | Elenca impostazioni e percorso del file |
| `config init` | Configura le impostazioni in modo interattivo |
| `token set [--stdin]` | Salva il token con input nascosto o da una pipe |
| `token [status]` | Mostra la sorgente della credenziale attiva |
| `token delete` | Elimina il token persistente |
| `git <args...>` | Inoltra gli argomenti a Git |
| `get-pr-url [source] [target]` | Cerca una PR aperta nel repository corrente |
| `get-pr-urls <source> <target>` | Cerca PR aperte attraverso i repository di un progetto |
| `create-pr [source] [target]` | Crea una PR usando i commit remoti |
| `merge-pr [source] [target]` | Esegue il merge di una PR tramite REST |

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
```

Il comando cerca la PR aperta e ne rilegge i dettagli aggiornati. Una PR senza reviewer può essere mergiata; con reviewer presenti serve almeno uno stato `APPROVED` e nessuno stato `NEEDS_WORK`.

Il merge viene richiesto tramite REST con la versione corrente della PR. Bitbucket applica i merge check del repository e rileva i conflitti. La CLI non esegue checkout, stash, merge locale o push. Se la PR non esiste, il comando termina con errore.

`--message-prefix` recupera il messaggio di merge suggerito da Bitbucket, antepone il prefisso preservandone gli spazi e invia `autoSubject: false`. Senza prefisso, lascia al server la generazione del messaggio. Se il suggerimento richiesto non è disponibile, il merge viene interrotto.

`--complete-tasks` completa i task ancora aperti prima del merge. Legge tutte le pagine, recupera la versione aggiornata di ciascun task da modificare e ne imposta lo stato a `RESOLVED`. Poi rilegge la PR e ricontrolla branch, reviewer, stato e versione. L'opzione mantiene attivi i controlli sui reviewer e i merge check del server.

Se il completamento di un task o un passaggio successivo fallisce, i task già completati restano tali. Gli errori di permessi o di versione interrompono l'operazione. Il branch source non viene cancellato: `--delete-source-branch` non è attualmente implementata.

In caso di successo viene stampato soltanto l'URL della PR mergiata.

## Output ed errori

L'help esplicito termina con exit code `0`. Gli errori di parsing o applicativi terminano con exit code `1` e un messaggio su stderr. L'invocazione senza comando mostra l'help su stderr con exit code `1`.

Il pass-through `git` propaga l'exit code del processo Git. Le PR non trovate dai comandi di ricerca producono un risultato vuoto con exit code `0`; `merge-pr` richiede invece una PR esistente.

La CLI ripristina la directory e svuota la cache del token anche nei percorsi di help ed errore. Le paginazioni con indici mancanti, non interi o che non avanzano vengono interrotte con errore.

Ogni richiesta REST Bitbucket ha un timeout di 60 secondi, che copre anche la lettura del corpo della risposta. Il limite riguarda la singola richiesta, non l'intero comando. Gli errori conservano metodo, percorso e status HTTP quando disponibile. Non vengono eseguiti retry automatici: dopo un timeout durante creazione, merge o aggiornamento di un task, verificare lo stato sul server prima di ripetere l'operazione.

Le risposte di successo devono contenere JSON valido, salvo i corpi vuoti consentiti dalle singole operazioni. I moduli REST verificano struttura delle pagine, repository, PR, reviewer, task e suggerimenti del messaggio di merge prima di utilizzarli. Una pagina HTML di login o una risposta incompleta produce un errore esplicito anziché un errore di accesso ai campi. Gli errori di JSON malformato non mostrano il contenuto ricevuto. Una risposta non valida dopo una scrittura non implica che il server abbia annullato l'operazione.

## Sviluppo e verifica

```powershell
npm run typecheck
npm test
```

I test usano il runner nativo Node, client sostituibili e risposte HTTP simulate. Non richiedono un server Bitbucket, un token reale o operazioni Git remote. Alcuni test eseguono subprocess Node per verificare la CLI e usano configurazioni temporanee isolate.

I comandi dipendono da contratti strutturali ottenuti con `Pick`, così i test possono fornire semplici oggetti con i metodi necessari. I test di `BitbucketClient` iniettano `fetch` nelle opzioni del costruttore; quelli di `GitClient` iniettano `execute` nel quarto argomento opzionale, senza sostituire le funzioni globali di rete o processo. In esecuzione normale i client usano le API native Node. `npm test` seleziona `test/*.test.ts` ed esclude gli helper condivisi dalla scoperta delle suite.

La verifica del pacchetto installabile è separata e si avvia con `npm run test:package`.

I test di `TokenStore` usano backend fittizi per verificare precedenza delle credenziali, validazione e cache. I backend macOS e Linux e gli errori dei tool nativi sono verificati tramite un esecutore simulato, senza sostituire funzioni globali di Node. Il test reale DPAPI su Windows è opzionale, usa una directory temporanea e un token fittizio e può essere abilitato così:

```powershell
$env:BB_TEST_NATIVE_TOKEN_STORE = "1"
node --test test/token-backends.test.ts
Remove-Item Env:BB_TEST_NATIVE_TOKEN_STORE
```

Le regole architetturali e lo stato del progetto sono descritti in [AGENTS.md](AGENTS.md).

## Attività rimanenti

- Distribuire il tarball validato attraverso il canale interno scelto per le release.
- Verificare i flussi autenticati contro il server Bitbucket aziendale: le verifiche automatizzate attuali sono offline.
- Verificare dal vivo Keychain e Secret Service nei rispettivi ambienti di destinazione; la loro copertura automatizzata attuale usa tool simulati.
