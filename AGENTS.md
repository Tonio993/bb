# AGENTS.md

## Scopo del progetto

`bb` è una CLI interna per semplificare operazioni Git e Bitbucket Data Center utilizzate frequentemente nello sviluppo.

Il progetto nasce come tool PowerShell ed è in fase di migrazione verso **Node.js + TypeScript**.

La versione Node deve progressivamente raggiungere la parità funzionale con la versione PowerShell, migliorandone allo stesso tempo:

* portabilità;
* manutenibilità;
* testabilità;
* separazione delle responsabilità;
* gestione delle dipendenze;
* consistenza della CLI;
* gestione degli errori.

La versione PowerShell esistente deve essere considerata come riferimento funzionale quando il comportamento atteso non è evidente dal codice Node.

La guida operativa, i requisiti e i limiti dell'implementazione attuale sono descritti in [README.md](README.md).

---

# Stack tecnologico

Usare:

* Node.js 24 LTS o successivo compatibile;
* TypeScript;
* Commander.js per la CLI;
* API native Node quando sufficienti;
* `fetch` nativo di Node per HTTP;
* `child_process` per Git;
* npm per la gestione delle dipendenze.

Evitare dipendenze esterne se la standard library Node fornisce già una soluzione semplice e affidabile.

---

# Esecuzione TypeScript

Durante lo sviluppo TypeScript viene eseguito direttamente da Node.

Esempio:

```powershell
node .\src\main.ts get-pr-url develop
```

Non è prevista una fase di transpilation durante il normale sviluppo.

Per la distribuzione npm, `npm run build` genera invece JavaScript in `dist/` tramite `tsconfig.build.json`. Il comando `npm pack` avvia questo build tramite `prepack`. Il launcher `bb` punta a `dist/main.js`, perché Node.js 24 non esegue TypeScript sotto `node_modules`.

Il build di distribuzione non deve cambiare il flusso di sviluppo diretto e non deve generare `.exe`.

Il progetto usa:

```json
"erasableSyntaxOnly": true
```

Di conseguenza evitare sintassi TypeScript che richiede trasformazione in JavaScript.

In particolare evitare:

```typescript
constructor(
    private readonly client: Client,
) {}
```

Usare invece:

```typescript
private readonly client: Client;

constructor(
    client: Client,
) {
    this.client = client;
}
```

Evitare anche altri costrutti incompatibili con `erasableSyntaxOnly`.

Dopo ogni modifica significativa eseguire:

```powershell
npm run typecheck
```

e correggere tutti gli errori prima di considerare completata l'attività.

---

# Principi generali

Privilegiare, in quest'ordine:

1. leggibilità;
2. semplicità;
3. riutilizzabilità;
4. testabilità;
5. basso boilerplate;
6. separazione delle responsabilità.

Non introdurre astrazioni se non esiste ancora una necessità concreta.

Non ricreare pattern tipici di Java/Spring se non portano un beneficio reale nel contesto Node/TypeScript.

Preferire composizione e dipendenze esplicite.

---

# Lingua

Le comunicazioni e la documentazione progettuale possono essere in italiano.

Tutto ciò che compare nel codice destinato agli utenti o agli sviluppatori deve invece essere in **inglese**, compresi:

* commenti;
* help CLI;
* descrizioni dei comandi;
* messaggi di errore;
* nomi delle funzioni;
* nomi delle classi;
* nomi dei tipi;
* nomi delle variabili.

---

# Struttura del progetto

La struttura prevista è indicativamente:

```text
src/
├── main.ts
│
├── auth/
│   ├── token-input.ts
│   └── token-store.ts
│
├── bitbucket/
│   ├── bitbucket-api-error.ts
│   ├── bitbucket-client.ts
│   ├── bitbucket-types.ts
│   ├── pull-requests.ts
│   └── repositories.ts
│
├── cli/
│   ├── cli.ts
│   └── command-context.ts
│
├── commands/
│   ├── index.ts
│   ├── config-command.ts
│   ├── token-command.ts
│   ├── git-command.ts
│   ├── get-pr-url-command.ts
│   ├── get-pr-urls-command.ts
│   ├── create-pr-command.ts
│   └── merge-pr-command.ts
│
├── config/
│   └── config.ts
│
├── git/
│   ├── git-client.ts
│   └── git-command-error.ts
│
├── pullrequest/
│   ├── branches.ts
│   ├── merge-commit-message.ts
│   ├── pull-request-content.ts
│   ├── review-validation.ts
│   └── reviewers.ts
│
└── repository/
    └── repository-context.ts
```

Non creare directory o file vuoti anticipatamente.

Aggiungere nuovi moduli solo quando richiesti da funzionalità reali.

---

# Bootstrap

`src/main.ts` deve essere il **composition root** dell'applicazione.

Deve occuparsi principalmente di:

* creare gli store;
* creare i client;
* costruire `CommandContext`;
* invocare la CLI;
* gestire l'errore finale;
* effettuare eventuale cleanup globale.

Non deve contenere logica specifica dei singoli comandi.

Esempio concettuale:

```text
main.ts
   │
   ├─ ConfigStore
   ├─ BitbucketClient
   ├─ GitClient
   │
   ▼
CommandContext
   │
   ▼
runCli()
```

---

# CommandContext

Le dipendenze applicative devono essere passate ai comandi tramite `CommandContext`.

Esempio:

```typescript
export type CommandContext = {
    readonly tokenStore: TokenStore;
    readonly configStore: ConfigStore;
    readonly config: BbConfig;
    readonly bitbucketClient: BitbucketClient;
    readonly gitClient: GitClient;
};
```

Non passare liste crescenti di dipendenze direttamente alle funzioni CLI.

Evitare dipendenze applicative globali implicite.

---

# CLI

La CLI usa **Commander.js**.

Non implementare parser manuali degli argomenti se Commander può gestire direttamente il caso.

Usare convenzioni CLI standard:

```text
--project-key
--source-branch
--target-branch
--reviewer
--no-reviewers
--message-prefix
--complete-tasks
--delete-source-branch
```

`--delete-source-branch` indica la convenzione per un'eventuale funzionalità futura: non è implementata nel comando `merge-pr` attuale.

Evitare la sintassi PowerShell precedente:

```text
-ProjectKey
-TargetBranch
```

---

# Registrazione dei comandi

Ogni comando deve registrarsi tramite una funzione del tipo:

```typescript
export function registerCreatePrCommand(
    program: Command,
    context: CommandContext,
): void
```

I registrar vengono raccolti in:

```text
src/commands/index.ts
```

Esempio:

```typescript
const commandRegistrars: CommandRegistrar[] = [
    registerConfigCommand,
    registerGitCommand,
    registerGetPrUrlCommand,
    registerGetPrUrlsCommand,
    registerCreatePrCommand,
    registerMergePrCommand,
];
```

`cli.ts` non deve contenere `switch` specifici per i nomi dei comandi.

Help, routing e parsing devono essere delegati a Commander.

---

# Opzione globale -C

La CLI supporta:

```powershell
bb -C C:\repository get-pr-url develop
```

`-C` / `--path` prima del comando è un'opzione globale di `bb`.

Deve cambiare temporaneamente la working directory prima dell'esecuzione del comando e ripristinarla successivamente.

Il comando:

```powershell
bb git -C C:\repository status
```

deve invece inoltrare `-C` direttamente a Git.

Il comando `git` deve essere trattato come pass-through.

---

# Configurazione globale

La configurazione non deve risiedere nel repository.

Non usare:

```text
config/config.json
```

come configurazione applicativa locale.

La configurazione deve essere globale per utente.

Su Windows:

```text
%APPDATA%\bb\config.json
```

Su Linux usare preferibilmente:

```text
$XDG_CONFIG_HOME/bb/config.json
```

oppure:

```text
~/.config/bb/config.json
```

Su macOS usare una directory standard sotto:

```text
~/Library/Application Support/bb/
```

La logica deve essere centralizzata in `ConfigStore`.

---

# Configurazioni supportate

Le configurazioni previste sono:

```text
bitbucket.url
bitbucket.projectKey
bitbucket.defaultReviewers
git.remote
```

Valori obbligatori:

```text
bitbucket.url
bitbucket.projectKey
```

Valori opzionali:

```text
bitbucket.defaultReviewers
git.remote
```

Default:

```text
git.remote = origin
```

---

# Comando config

La CLI deve supportare:

```powershell
bb config
bb config list
bb config init
```

Lettura:

```powershell
bb config bitbucket.url
```

Scrittura:

```powershell
bb config bitbucket.url "https://bitbucket.company.com"
bb config bitbucket.projectKey "PROJECT"
bb config bitbucket.defaultReviewers "mrossi,lbianchi"
bb config git.remote "origin"
```

`bb config init` deve essere interattivo e permettere di configurare una variabile alla volta.

Se un valore esistente è disponibile, deve essere mostrato come default e mantenuto premendo Invio.

`list` e `init` sono sottocomandi Commander e non accettano argomenti posizionali aggiuntivi. La lettura e scrittura delle singole chiavi rimangono nell'action del comando `config`.

---

# Configurazione lazy

La configurazione obbligatoria non deve essere validata all'avvio dell'applicazione.

Questo è necessario perché:

```powershell
bb config init
```

deve funzionare anche quando non esiste ancora alcuna configurazione.

I comandi che richiedono la configurazione devono farla caricare solo quando necessario.

Esempio concettuale:

```typescript
get config() {
    return configStore.loadRequired();
}
```

---

# Configurazione mancante

Quando manca una configurazione obbligatoria, l'errore deve spiegare chiaramente come correggere il problema.

Esempio:

```text
Error: Required configuration 'bitbucket.url' is missing.

Configure it with:
  bb config bitbucket.url "https://bitbucket.company.com"

Or run:
  bb config init
```

Non usare messaggi generici come:

```text
Configuration missing.
```

---

# Token Bitbucket

Il token Bitbucket è un secret e non deve essere salvato dentro `config.json`.

`TokenStore` è creato nel composition root e passato ai comandi tramite `CommandContext`. I client Git e Bitbucket ricevono un provider esplicito che legge dallo stesso store, senza cache globali implicite.

Priorità di lettura:

```text
BB_TOKEN, se definita
  ↓
store sicuro della piattaforma
```

La variabile d'ambiente permette l'autenticazione anche in CI e sessioni senza portachiavi e non viene salvata dalla CLI.

Su Windows viene riutilizzato il token della versione PowerShell, memorizzato in:

```text
%APPDATA%\bb\token.dat
```

Il token è cifrato tramite Windows DPAPI.

La versione Node attuale può invocare temporaneamente PowerShell per decifrarlo.

Flusso attuale:

```text
Node
  ↓
PowerShell
  ↓
DPAPI
  ↓
Bitbucket token
```

I backend attuali sono:

```text
TokenStore
├── Windows DPAPI, compatibile con token.dat esistente
├── macOS Keychain
└── Linux Secret Service tramite secret-tool
```

Non introdurre un ripiego su file in chiaro. Su macOS usare il servizio `bb.bitbucket` e l'account `token`; su Linux gli attributi `service=bb.bitbucket` e `account=token`.

La CLI espone `token set`, `token status` e `token delete`. L'impostazione usa input nascosto oppure `--stdin`; il token non deve essere accettato come argomento della command line, visualizzato nell'output o incluso nelle diagnostiche. Gli aggiornamenti nativi ricevono il secret tramite stdin. Non inoltrare stderr dei tool nativi senza filtraggio.

`token status` mostra soltanto la sorgente attiva e restituisce exit code `1` quando il token manca. Impostazione e cancellazione riguardano lo store persistente e non modificano `BB_TOKEN`.

Il token persistente viene caricato lazy e mantenuto in cache per la durata dell'esecuzione, con cleanup nel `finally` del bootstrap. Help, configurazione e Git locale non devono avviare i backend. I test ordinari devono simulare i tool nativi; la prova reale DPAPI usa solo un token fittizio isolato e richiede `BB_TEST_NATIVE_TOKEN_STORE=1`.

---

# Bitbucket

Il server utilizzato è **Bitbucket Data Center / Server**, non Bitbucket Cloud.

Le API seguono il formato:

```text
/rest/api/latest/...
```

Esempio:

```text
/rest/api/latest/projects/{projectKey}/repos/{repository}/pull-requests
```

Non utilizzare endpoint specifici di Bitbucket Cloud.

---

# BitbucketClient

Tutte le chiamate HTTP verso Bitbucket devono passare attraverso:

```text
BitbucketClient
```

Il client deve centralizzare:

* base URL;
* autenticazione Bearer;
* `Accept: application/json`;
* `Content-Type: application/json; charset=utf-8`;
* serializzazione JSON;
* deserializzazione;
* error handling;
* normalizzazione degli URL.

Non eseguire `fetch` direttamente nei comandi.

---

# BitbucketApiError

Gli errori REST Bitbucket devono usare `BitbucketApiError`.

Il tipo deve mantenere almeno:

```text
statusCode
method
path
message
```

Questo deve permettere in futuro di distinguere:

```text
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
```

Non analizzare stringhe di errore se l'informazione strutturata è già disponibile.

---

# Error

Non creare una classe custom per ogni errore.

Usare `Error` per:

* validazioni;
* parametri incompatibili;
* configurazione applicativa;
* invarianti di dominio;
* dati mancanti inattesi.

Esempio:

```typescript
throw new Error(
    "Source and target branches cannot be the same.",
);
```

Usare errori custom solo quando il chiamante può avere bisogno di informazioni strutturate.

Attualmente:

```text
BitbucketApiError
GitCommandError
```

sono errori custom appropriati.

---

# GitClient

Tutte le interazioni Git devono passare attraverso `GitClient`.

Non invocare direttamente `spawnSync("git", ...)` dai command file.

Il client deve fornire operazioni riutilizzabili, ad esempio:

```typescript
gitClient.run(...)
gitClient.currentBranch()
gitClient.currentRepository()
gitClient.fetch()
gitClient.localBranchExists(...)
gitClient.remoteBranchExists(...)
gitClient.assertRemoteBranchExists(...)
gitClient.commitsBetween(...)
```

---

# Git locale vs remoto

Le operazioni locali non devono recuperare il token.

Esempi:

```text
git branch --show-current
git rev-parse
git show-ref
git status
git log
```

Le operazioni remote devono usare autenticazione Bitbucket.

Esempi:

```text
git fetch
git pull
git push
git clone
git ls-remote
```

Nel pass-through `bb git`, il riconoscimento automatico dell'autenticazione copre questi cinque comandi diretti, anche dopo opzioni globali Git come `-C` e `-c`. Non espande gli alias e non interpreta gli altri sottocomandi remoti: per essi rimane disponibile l'autenticazione nativa di Git.

Evitare di avviare inutilmente PowerShell/DPAPI per comandi Git locali.

---

# Autenticazione Git

Il token non deve essere inserito direttamente nella command line di `git.exe`.

Non usare come soluzione principale:

```text
git -c "http.extraHeader=Authorization: Bearer TOKEN"
```

Preferire l'environment temporaneo del processo Git:

```text
GIT_CONFIG_COUNT
GIT_CONFIG_KEY_n
GIT_CONFIG_VALUE_n
```

con:

```text
http.extraHeader
Authorization: Bearer TOKEN
```

Preservare eventuali `GIT_CONFIG_*` già presenti.

Le variabili devono esistere solo nell'environment del processo figlio.

---

# GitCommandError

Gli errori Git strutturati devono poter conservare:

```text
exitCode
args
message
```

Il comando pubblico:

```powershell
bb git ...
```

deve però comportarsi come pass-through e propagare normalmente l'exit code restituito da Git.

---

# RepositoryContext

La risoluzione di project key e repository deve essere centralizzata.

Esempio:

```typescript
type RepositoryContext = {
    projectKey: string;
    repository: string;
};
```

Priorità:

```text
projectKey:
  override CLI
  ↓
  config.bitbucket.projectKey

repository:
  override esplicito
  ↓
  repository Git corrente
```

Non duplicare questa logica nei comandi.

---

# Branch Pull Request

La risoluzione source/target deve mantenere il comportamento della CLI PowerShell.

Caso:

```powershell
bb get-pr-url develop
```

se il branch corrente è:

```text
feature/ABC-123
```

deve essere interpretato come:

```text
source = feature/ABC-123
target = develop
```

Caso:

```powershell
bb get-pr-url feature/ABC-123 develop
```

deve usare entrambi i branch esplicitamente.

Source e target non possono coincidere.

Non eseguire `git branch --show-current` quando source e target sono già entrambi noti.

---

# get-pr-url

Comando implementato.

Esempi:

```powershell
bb get-pr-url develop
bb get-pr-url feature/my-change develop
bb get-pr-url --target-branch develop
bb get-pr-url develop --project-key PROJECT
bb -C C:\repository get-pr-url develop
```

Comportamento:

* usa il repository Git corrente;
* recupera una PR aperta con source/target indicati;
* supporta paginazione Bitbucket;
* stampa esclusivamente l'URL della PR;
* se la PR non esiste, termina correttamente senza output.

---

# get-pr-urls

Comando implementato.

Deve cercare PR aperte attraverso tutti i repository di un progetto.

Esempio:

```powershell
bb get-pr-urls feature/ABC-123 develop
```

Deve supportare:

```text
--project-key
--repository-filter
```

`--repository-filter` supporta wildcard:

```text
*
?
```

e deve cercare sia su repository `name` sia su `slug`, case-insensitive.

Esempi:

```powershell
bb get-pr-urls feature/ABC-123 develop --repository-filter "service-*"

bb get-pr-urls feature/ABC-123 develop --repository-filter "*payment*"
```

Se non ci sono PR corrispondenti, nessun output e exit code di successo.

---

# create-pr

Il comportamento atteso deve replicare quello PowerShell.

Esempio principale:

```powershell
bb create-pr develop
```

se il branch corrente è:

```text
feature/my-change
```

deve creare:

```text
feature/my-change -> develop
```

Prima della creazione:

1. eseguire `git fetch`;
2. verificare source branch remoto;
3. verificare target branch remoto;
4. calcolare titolo e descrizione sulle differenze remote.

Il confronto deve essere:

```text
origin/target..origin/source
```

o equivalente utilizzando il remote configurato.

Non usare branch locali per generare il contenuto della PR.

---

# Contenuto create-pr

Escludere merge commit:

```text
--no-merges
```

Ordinare dal commit più vecchio al più recente:

```text
--reverse
```

Se c'è un solo commit non-merge:

```text
PR title = subject del commit
```

Se ci sono più commit:

```text
PR title = source branch
```

La descrizione deve mantenere sempre una lista markdown.

Esempio:

```markdown
* Commit 1
    * Body line 1
    * Body line 2

&nbsp;

* Commit 2
```

Anche con un solo commit la descrizione deve restare una lista.

---

# Reviewer create-pr

Configurazione di default:

```text
bitbucket.defaultReviewers
```

CLI:

```powershell
bb create-pr develop
```

usa i reviewer di default.

Override:

```powershell
bb create-pr develop --reviewer mario --reviewer luca
```

oppure:

```powershell
bb create-pr develop --reviewer mario,luca
```

Disabilitazione:

```powershell
bb create-pr develop --no-reviewers
```

`--reviewer` e `--no-reviewers` non possono essere usati insieme.

Con Commander:

```text
--no-reviewers
```

genera normalmente:

```typescript
options.reviewers === false
```

Questa semantica può essere mantenuta.

---

# merge-pr

La nuova implementazione Node deve preferire il **merge tramite REST API Bitbucket**.

Non portare automaticamente il vecchio workflow PowerShell basato su:

```text
checkout
pull
merge locale
push
stash
restore
```

se l'API REST di merge funziona correttamente.

Endpoint:

```text
POST /rest/api/latest/projects/{projectKey}/repos/{repository}/pull-requests/{pullRequestId}/merge
```

Passare almeno la `version` corrente della PR.

Il merge deve rispettare i merge check Bitbucket.

---

# Review validation merge-pr

Prima del merge applicare le regole:

* una PR senza reviewer può essere mergiata;
* se sono presenti reviewer, almeno uno deve essere `APPROVED`;
* se almeno un reviewer è `NEEDS_WORK`, il merge deve essere bloccato.

Questa logica deve stare nel dominio Pull Request e non direttamente nel command file se può essere riutilizzata/testata.

---

# MessagePrefix merge-pr

`merge-pr` deve supportare:

```text
--message-prefix
```

Il prefisso deve essere applicato al **merge commit message effettivamente creato da Bitbucket**.

Se è necessario inviare un messaggio personalizzato all'endpoint REST, recuperare prima il merge commit message suggerito da Bitbucket e anteporre il prefisso.

Quando viene inviato un messaggio esplicito, evitare che Bitbucket aggiunga un ulteriore subject automatico, se supportato dalla versione API in uso.

---

# Task merge-pr

`merge-pr` supporta l'opzione esplicita:

```powershell
bb merge-pr develop --complete-tasks
```

Senza l'opzione, i task non vengono modificati dalla CLI.

Con l'opzione:

1. validare stato, versione e reviewer della PR;
2. leggere tutte le pagine dei task prima di aggiornarli;
3. rileggere ciascun task ancora da completare e usare la sua versione corrente;
4. impostare a `RESOLVED` soltanto i task ancora aperti;
5. rileggere la PR e ricontrollare branch, stato, versione e reviewer prima del merge.

Le chiamate REST dei task passano attraverso `BitbucketClient`. Un errore o conflitto durante un aggiornamento deve interrompere l'operazione senza tentare il merge. I task già completati restano completati anche se un passaggio successivo fallisce.

Questa opzione non disabilita le regole sui reviewer e i merge check Bitbucket. Non introdurre retry che sovrascrivano modifiche concorrenti senza una necessità esplicita.

---

# Bitbucket Pull Request types

Mantenere tipi espliciti per le response principali.

Esempi:

```typescript
BitbucketPullRequest
BitbucketPullRequestRef
BitbucketRepository
BitbucketPage<T>
```

Non usare `any` se il formato della risposta è noto.

Usare `unknown` quando il contenuto deve essere validato prima dell'accesso.

---

# Paginazione

Le API Bitbucket restituiscono risultati paginati.

La logica deve gestire:

```text
isLastPage
nextPageStart
start
limit
values
```

Il limite utilizzato normalmente può essere:

```text
100
```

Non assumere che la prima pagina contenga tutti i risultati.

---

# Performance

L'ambiente aziendale applica controlli antivirus/EDR aggressivi agli eseguibili appena generati.

Per questo il progetto è stato spostato da Go a Node.js.

Durante lo sviluppo evitare la generazione continua di `.exe`.

Preferire:

```powershell
node src/main.ts ...
```

Node installato e firmato viene gestito meglio dai sistemi aziendali rispetto a eseguibili compilati localmente con hash differente a ogni build.

Evitare subprocess non necessari, perché sull'ambiente corrente l'avvio di nuovi processi introduce overhead significativo.

In particolare:

* non invocare Git se il dato è già disponibile;
* non decifrare il token se il comando non richiede autenticazione;
* riutilizzare client e configurazione durante la stessa esecuzione.

---

# Dipendenze npm

`package-lock.json` deve essere versionato.

`node_modules/` non deve essere versionato.

Prima di aggiungere una nuova dipendenza npm valutare se:

* Node standard library risolve già il problema;
* Commander offre già la funzionalità;
* il beneficio giustifica la nuova dipendenza.

---

# Gitignore

Il repository deve ignorare almeno:

```gitignore
node_modules/

dist/
build/
out/

coverage/
.nyc_output/

*.tsbuildinfo

.env
.env.*
!.env.example

.vscode/
.idea/

.DS_Store
Thumbs.db
Desktop.ini

tmp/
temp/
*.tmp
*.swp
*.swo

report.*.json

*.exe
*.msi
*.zip
*.tar.gz

test-results/
```

Non ignorare:

```text
package.json
package-lock.json
tsconfig.json
AGENTS.md
```

---

# Testing

Aggiungere test soprattutto alle funzioni pure e alla logica di dominio.

Priorità:

```text
resolvePullRequestBranches
resolvePullRequestReviewers
RepositoryContext
ConfigStore
wildcard repository matching
Bitbucket error parsing
Pull Request content generation
review validation
```

Evitare test che dipendano realmente da Bitbucket o Git quando la logica può essere testata tramite dipendenze sostituibili.

Il progetto deve rimanere facilmente testabile senza framework di dependency injection.

---

# Compatibilità con la versione PowerShell

Durante il porting confrontare il comportamento Node con la versione PowerShell.

Preservare quando possibile:

* semantica dei comandi;
* output;
* exit code;
* regole sui branch;
* reviewer;
* generazione PR;
* merge checks.

È accettabile migliorare la sintassi CLI secondo convenzioni standard Unix.

Esempio:

```text
PowerShell:
-ProjectKey

Node:
--project-key
```

---

# Stato del porting

Implementato e verificato tramite test offline:

```text
Node.js + TypeScript setup
Commander.js e gestione delle uscite con cleanup
CommandContext
GitClient
BitbucketClient
BitbucketApiError
GitCommandError
TokenStore multipiattaforma con override BB_TOKEN
token set / token status / token delete e input nascosto
ConfigStore globale e configurazione lazy
config / config list / config init
pass-through Git con autenticazione selettiva
get-pr-url
get-pr-urls
RepositoryContext
branch resolution
create-pr con contenuto dai riferimenti remoti
reviewer di default, override e disabilitazione
merge-pr REST con versione corrente e validazione review
merge commit message prefix
completamento opzionale dei task PR
paginazione e wildcard repository
test di dominio, client e CLI
README operativo
build JavaScript di distribuzione e launcher npm bb
tarball con allowlist dei soli file runtime e README
verifica separata del pacchetto installato in un prefisso temporaneo
```

Le verifiche automatizzate usano risposte HTTP simulate e dipendenze Git sostituibili. Non equivalgono a una verifica dei flussi autenticati contro il server Bitbucket aziendale.

La configurazione globale, `create-pr`, `merge-pr` REST e la coerenza della CLI sono consolidati. Non ripartire da questi punti senza un difetto concreto o una nuova richiesta.

Attività successive:

```text
distribuzione/release interna del tarball
verifica dei flussi autenticati sul server aziendale
```

Il pacchetto rimane privato e dichiara il launcher `bb` tramite `bin`. La preparazione usa `npm pack`; l'installazione usa `npm install --global` sul tarball. Durante lo sviluppo continuare a usare `node src/main.ts ...`.

Eseguire `npm run test:package` quando cambiano packaging, build, dipendenze runtime o launcher. Questo controllo costruisce un tarball e verifica l'installazione con sole dipendenze di produzione in un prefisso temporaneo. Deve rimanere separato dalla suite offline `npm test` e non deve sostituire l'installazione globale dell'utente o leggere la configurazione reale.

DPAPI rimane compatibile con la CLI PowerShell. Keychain e Secret Service sono coperti da test con tool simulati e richiedono verifica nativa negli ambienti di destinazione. L'eventuale cancellazione del branch source è una funzionalità futura da valutare separatamente.

---

# Modalità di lavoro richiesta a Codex

Prima di modificare codice:

1. leggere questo `AGENTS.md`;
2. ispezionare i file attuali del repository;
3. verificare cosa è realmente già implementato;
4. non assumere che ogni frammento descritto qui esista già nel codice.

Il repository reale è la fonte di verità sullo stato dell'implementazione.

`AGENTS.md` descrive architettura, obiettivi e comportamento atteso.

Quando viene richiesta una modifica:

1. identificare i file coinvolti;
2. riutilizzare le astrazioni esistenti;
3. evitare duplicazioni;
4. mantenere le responsabilità separate;
5. eseguire `npm run typecheck`;
6. correggere gli errori;
7. se esistono test pertinenti, eseguirli;
8. riassumere brevemente le modifiche effettuate.

Non effettuare refactoring estesi non richiesti se non sono necessari per implementare correttamente la funzionalità.

Se viene individuato un miglioramento architetturale significativo non necessario alla richiesta corrente, segnalarlo prima invece di applicarlo automaticamente.

---

# Obiettivo finale

L'obiettivo finale è una CLI:

```text
bb
```

leggera, leggibile, portabile e facilmente distribuibile, con comportamento coerente su più piattaforme.

La CLI deve nascondere la complessità di:

```text
Bitbucket REST
Git authentication
repository discovery
Pull Request creation
Pull Request discovery
Pull Request merge
configuration
token management
```

offrendo comandi semplici e prevedibili agli sviluppatori.
