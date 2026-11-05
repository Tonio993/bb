# Evoluzioni di bb

Questo elenco conserva la numerazione concordata. Descrive le evoluzioni dell'applicazione; i passi interni di ciascuna attività hanno una numerazione separata. L'implementazione reale e le verifiche restano descritte in [README](../README.md) e [architettura](architecture.md).

| Punto | Evoluzione                                          | Stato           |
| ----- | --------------------------------------------------- | --------------- |
| 1     | Diagnostica dell'ambiente: `bb doctor`              | Implementata    |
| 2     | Riconoscimento del repository dal remote Git        | Implementata    |
| 3     | Output strutturato per script e CI: `--json`        | Implementata    |
| 4     | Consultazione delle PR: `bb pr list` e `bb pr show` | Implementata    |
| 5     | Verifica preventiva del merge: `bb pr checks`       | Implementata    |
| 6     | Anteprima delle operazioni: `--dry-run`             | Implementata    |
| 7     | Creazione PR più personalizzabile                   | Implementata    |
| 8     | Release versionate e installazione stabile          | Da implementare |
| 9     | Verifiche integrate contro ambienti reali           | Da completare   |
| 10    | Profili per più ambienti Bitbucket                  | Da implementare |
| 11    | Ricerca su molti repository più rapida              | Da implementare |
| 12    | Operazioni su più PR                                | Da implementare |

1. **Diagnostica.** Versioni Node/npm/Git, configurazione, tool del portachiavi, lettura della credenziale e verifica remota su richiesta.
2. **Identità dal remote.** Progetto e repository da HTTP(S), SSH e SCP, con context path, override espliciti e associazioni SSH.
3. **JSON.** Formato versionato per ricerca, creazione, merge e diagnostica, con codici di errore documentati e output testuale predefinito. Il contratto è in [json-output.md](json-output.md).
4. **Consultazione PR.** `pr list` e `pr show` espongono titolo, autore, branch, reviewer e task aperti, con filtri per repository, autore e stato e selezione tramite ID o URL. Supportano output testuale e JSON, con sole letture REST.
5. **Controlli del merge.** `pr checks` riunisce requisiti locali, reviewer, task e motivazioni di blocco del server, con output testuale/JSON ed exit code per automazioni. Rimane da confermare il comportamento delle API sulla versione aziendale.
6. **Anteprima.** `create-pr --dry-run` mostra contenuto e reviewer dopo il fetch Git; `merge-pr --dry-run` mostra PR, task da completare, messaggio e cancellazione source prevista con sole GET. Output testuale e JSON, senza scritture REST.
7. **Creazione personalizzabile.** File UTF-8, template CLI/globale, browser opzionale e ricerca paginata di PR aperte con gli stessi ref e repository. Supporto di anteprima e JSON senza retry delle scritture.
8. **Release.** Tag, tarball validati, checksum, changelog e `bb --version`, con installazione di versioni precise.
9. **Ambienti reali.** Suite opzionale su un progetto Bitbucket di test e prove native Keychain/Secret Service. Le simulazioni offline e la matrice CI non sostituiscono queste verifiche.
10. **Profili.** Configurazioni e credenziali separate per server/ambiente, selezionabili tramite `--profile`.
11. **Prestazioni.** Concorrenza limitata tra repository, paginazione sequenziale interna e ordine deterministico; misurare i benefici prima di introdurre cache.
12. **Più PR.** Ricerca, verifiche e successivi merge attraverso più repository, con esiti separati e successi parziali espliciti.

L'opzione `merge-pr --delete-source` è stata implementata come estensione del merge e non cambia questa numerazione. Il prossimo punto della roadmap è il **8**.
