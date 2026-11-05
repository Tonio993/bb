# Output JSON, schema versione 1

`--json` è disponibile per `get-pr-url`, `get-pr-urls`, `create-pr`, `merge-pr` e `doctor`. L'output testuale resta il default. L'opzione cambia la rappresentazione del risultato, non le operazioni eseguite: creazione, merge, completamento dei task e cancellazione del source restano scritture reali quando richieste.

Questo documento è incluso nel pacchetto come `docs/json-output.md`, insieme alla versione della CLI cui si riferisce.

Per script e CI specificare il formato all'inizio dell'invocazione:

```powershell
bb --json get-pr-url feature/ABC-123 develop
bb --json get-pr-urls feature/ABC-123 develop --project-key PROJECT
bb --json create-pr feature/ABC-123 develop
bb --json merge-pr feature/ABC-123 develop --delete-source
bb --json doctor --remote
```

Dal checkout sostituire `bb` con `node src/main.ts`. Anche `bb doctor --json` e le altre forme con opzione locale sono supportate. Se un errore interrompe il parsing prima che Commander legga `--json`, rimane la modalità testuale: mettere l'opzione per prima consente di ottenere JSON anche per gli errori di sintassi successivi.

In modalità JSON viene emesso un solo documento su stdout, seguito da newline, con stderr vuoto. L'help esplicito resta testuale e termina con codice `0`, anche quando è presente `--json`. `config`, `token` e il pass-through `git` non supportano questo formato: un `--json` globale viene rifiutato prima di eseguire il comando. Dopo `bb git`, un argomento `--json` viene inoltrato a Git.

## Envelope

```json
{
  "schemaVersion": 1,
  "command": "get-pr-url",
  "ok": true,
  "exitCode": 0,
  "data": { "pullRequest": null },
  "error": null
}
```

| Campo           | Significato                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| `schemaVersion` | Versione del contratto, attualmente `1`.                                                   |
| `command`       | Nome canonico del comando; può essere `null` per errori prima dell'esecuzione dell'action. |
| `ok`            | `true` soltanto se `error` è `null`.                                                       |
| `exitCode`      | Uguale al codice del processo: `0` per successo, `1` per errore o risultato parziale.      |
| `data`          | Dati del comando, oppure `null` quando non è disponibile un risultato.                     |
| `error`         | Errore documentato, oppure `null`.                                                         |

Campi aggiuntivi compatibili potranno essere introdotti nella versione 1; i consumer devono ignorare quelli sconosciuti. Cambiamenti incompatibili richiederanno una nuova versione. I messaggi sono destinati alla lettura umana: per le decisioni automatiche usare `error.code` e i metadati, non confrontare il testo.

## Dati dei comandi

| Comando       | Forma di `data`                                                                |
| ------------- | ------------------------------------------------------------------------------ |
| `get-pr-url`  | `{ "pullRequest": PR oppure null }`                                            |
| `get-pr-urls` | `{ "pullRequests": [PR, ...] }`                                                |
| `create-pr`   | `{ "pullRequest": PR }`                                                        |
| `merge-pr`    | `{ "pullRequest": PR, "sourceDeletion": stato }`                               |
| `doctor`      | `{ "checks": [...], "summary": { "OK": n, "WARN": n, "FAIL": n, "SKIP": n } }` |

Una ricerca senza risultati è un successo: `null` per la ricerca singola, array vuoto per quella su più repository. L'ordine dei risultati segue la ricerca esistente.

Una PR contiene esclusivamente questi campi:

```json
{
  "id": 42,
  "version": 7,
  "state": "OPEN",
  "url": "https://bitbucket.example/projects/PROJECT/repos/payments/pull-requests/42",
  "source": {
    "projectKey": "PROJECT",
    "repository": "payments",
    "branch": "feature/ABC-123",
    "ref": "refs/heads/feature/ABC-123"
  },
  "target": {
    "projectKey": "PROJECT",
    "repository": "payments",
    "branch": "develop",
    "ref": "refs/heads/develop"
  },
  "reviewers": [{ "status": "APPROVED" }]
}
```

Gli identificativi sono numeri; gli altri campi sono stringhe, salvo `url`, che può essere `null` quando il link non è disponibile o non è un URL HTTP(S) valido. Dagli URL vengono rimossi userinfo, query e fragment. Source e target conservano le rispettive identità, anche per fork. La response REST completa, descrizioni e dati utente aggiuntivi non vengono serializzati.

`sourceDeletion` vale `not-requested`, `deleted` oppure `failed`. Nel terzo caso il merge è confermato: `data.pullRequest.state` è `MERGED`, `ok` è `false`, l'exit code è `1` e l'errore è `SOURCE_DELETION_FAILED`. Non ripetere automaticamente il merge per correggere la sola cancellazione.

I controlli di `doctor` hanno `name`, `status` e `message`; gli stati sono `OK`, `WARN`, `FAIL`, `SKIP`. Un `FAIL` produce `DIAGNOSTIC_FAILED` con rapporto e conteggi preservati. Soltanto avvisi e controlli saltati non causano un errore. JSON non abilita nuove letture di credenziali o richieste remote: valgono sempre `--check-token` e `--remote`.

## Errori

| `error.code`              | Significato                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `CLI_ARGUMENT_ERROR`      | Argomenti o sintassi non validi.                                                        |
| `JSON_OUTPUT_UNSUPPORTED` | Il comando scelto non supporta JSON.                                                    |
| `APPLICATION_ERROR`       | Validazione, configurazione, credenziali locali o altra invariante applicativa fallita. |
| `AUTHENTICATION_FAILED`   | HTTP 401: autenticazione o ambito della credenziale rifiutati.                          |
| `ACCESS_DENIED`           | HTTP 403.                                                                               |
| `NOT_FOUND`               | HTTP 404: risorsa assente o non accessibile.                                            |
| `CONFLICT`                | HTTP 409.                                                                               |
| `RATE_LIMITED`            | HTTP 429.                                                                               |
| `BITBUCKET_UNAVAILABLE`   | Errore HTTP del server, status >=500.                                                   |
| `HTTP_ERROR`              | Altro errore HTTP.                                                                      |
| `CONNECTION_FAILED`       | Connessione a Bitbucket non riuscita.                                                   |
| `TIMEOUT`                 | Deadline della richiesta superata, anche durante la lettura del corpo.                  |
| `INVALID_RESPONSE`        | Risposta non valida o non leggibile.                                                    |
| `GIT_ERROR`               | Operazione Git locale fallita.                                                          |
| `DIAGNOSTIC_FAILED`       | Almeno un controllo di `doctor` è `FAIL`.                                               |
| `SOURCE_DELETION_FAILED`  | Merge confermato, cancellazione source fallita o non confermata.                        |

Ogni errore ha `code` e `message`. Quando disponibili, gli errori Bitbucket aggiungono `httpStatus`, `method` e `kind`; quelli Git aggiungono `gitExitCode` e `signal`. `SOURCE_DELETION_FAILED` include in `cause` l'errore filtrato della cancellazione. Non vengono esposti corpo HTTP, header, argomenti Git, stack, cause native o messaggi nativi. Gli errori generici non includono il messaggio originale: per una diagnostica testuale più dettagliata usare il comando senza `--json`.

Un fallimento o un timeout durante una scrittura non ne conferma l'annullamento. I codici descrivono l'esito osservato dal client; prima di ripetere una scrittura verificare lo stato sul server. Il formato non introduce retry automatici.

## Consumo da PowerShell

```powershell
$bbOutput = bb --json get-pr-url feature/ABC-123 develop
$bbExitCode = $LASTEXITCODE
$bbResult = $bbOutput | ConvertFrom-Json
if ($bbExitCode -eq 0 -and $null -ne $bbResult.data.pullRequest) {
    $bbResult.data.pullRequest.url
}
```
