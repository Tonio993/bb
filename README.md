# bb

CLI interna per Git e Bitbucket Data Center / Server, in porting da PowerShell a Node.js e TypeScript.

Il progetto implementa configurazione globale, pass-through Git, ricerca, creazione e merge delle Pull Request. Le API utilizzate sono quelle di Bitbucket Data Center, sotto `/rest/api/latest/`.

## Requisiti e avvio

- Node.js 24 LTS o una versione successiva compatibile.
- npm.
- Git disponibile nel `PATH` per i comandi che lavorano sul repository locale.
- Windows e `powershell.exe` per le operazioni autenticate con il token store attuale.

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

L'archivio contiene il manifest, il README e i file JavaScript di `dist/`. Sorgenti TypeScript, test, configurazioni di sviluppo, token e dipendenze di sviluppo sono esclusi. Commander viene installato come dipendenza runtime da npm.

Per installare il tarball:

```powershell
npm install --global "./bb-0.1.0.tgz" --omit=dev
bb --help
bb config init
bb -C "C:\work\payments" get-pr-url develop
```

Il campo `bin` espone `dist/main.js` come comando `bb`. npm crea il launcher adatto alla piattaforma. Controllare con `npm prefix --global` il prefisso di installazione: la directory del prefisso su Windows, oppure la sua sottodirectory `bin` su Linux e macOS, deve essere nel `PATH`.

Se è già presente la CLI PowerShell, controllare quale comando viene risolto prima di usare il nuovo launcher:

```powershell
Get-Command bb -All
```

Per aggiornare, installare il nuovo tarball con lo stesso comando `npm install --global`. Per disinstallare:

```powershell
npm uninstall --global bb
```

La distribuzione interna avviene tramite tarball. `private: true` mantiene il blocco alla pubblicazione con `npm publish`.

`npm run test:package` costruisce un archivio temporaneo, ne controlla i file e lo installa con sole dipendenze di produzione e script di installazione disabilitati. Verifica il launcher da una directory esterna al checkout, l'help di `merge-pr` e una lettura della configurazione isolata. Il prefisso di prova viene rimosso al termine; l'installazione globale dell'utente e la configurazione reale non vengono modificate. Il controllo usa la cache npm e, quando necessario, il registry configurato per recuperare le dipendenze.

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

## Token Bitbucket

Il token è separato dalla configurazione ed è letto da `%APPDATA%\bb\token.dat`.

La versione Node riutilizza il file cifrato con Windows DPAPI dalla versione PowerShell. Per crearlo o aggiornarlo, usare lo script `setup/bb-set-token.ps1` del progetto PowerShell, con lo stesso account Windows che esegue la CLI:

```powershell
powershell.exe -NoProfile -File "C:\path\to\BitBucketHelper\setup\bb-set-token.ps1"
```

Lo script chiede il token in modo interattivo. Non è incluso in questo repository. La CLI Node non implementa ancora un comando per impostare il token.

Node invoca temporaneamente PowerShell per decifrare il file. Il token viene riutilizzato in memoria durante la stessa esecuzione e la cache viene svuotata al termine. Le operazioni locali non ne richiedono la decifratura.

Configurazione e operazioni Git locali possono funzionare anche su Linux e macOS; le operazioni che richiedono il token Bitbucket sono attualmente supportate solo su Windows.

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

Il token Bitbucket viene aggiunto automaticamente per i comandi diretti `fetch`, `pull`, `push`, `clone` e `ls-remote`. Comandi locali come `status`, `log` e `branch` non lo richiedono. Il token passa nell'environment temporaneo del processo figlio tramite `GIT_CONFIG_*`; non viene inserito nella command line.

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

## Sviluppo e verifica

```powershell
npm run typecheck
npm test
```

I test usano il runner nativo Node, client sostituibili e risposte HTTP simulate. Non richiedono un server Bitbucket, un token reale o operazioni Git remote. Alcuni test eseguono subprocess Node per verificare la CLI e usano configurazioni temporanee isolate.

La verifica del pacchetto installabile è separata e si avvia con `npm run test:package`.

Le regole architetturali e lo stato del porting sono descritti in [AGENTS.md](AGENTS.md).

## Attività rimanenti

- Distribuire il tarball validato attraverso il canale interno scelto per le release.
- Verificare i flussi autenticati contro il server Bitbucket aziendale: le verifiche automatizzate attuali sono offline.
- Valutare in seguito un token store portabile, mantenendo quello DPAPI durante il porting funzionale.
