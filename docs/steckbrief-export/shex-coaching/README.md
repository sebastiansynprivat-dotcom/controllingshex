# SheX Coaching: neuer Lese-Endpunkt `controlling-model-profiles`

Dieser Patch gehört ins Repository **gold-reveal-next** (SheX Coaching), nicht ins Controlling.
Er liegt hier, weil für gold-reveal-next weder Push-Rechte noch ein Fork verfügbar waren.

## Was er macht

Neue, rein lesende Edge Function für das Controlling (Vertrag: [`../vertraege.md`](../vertraege.md),
Abschnitt A):

- `list_models`: alle Models mit Name, Username, aktiv und Freigabestatus. Keine Mails, keine Inhalte.
- `resolve`: löst Login-Identitäten (Plattform + Mail) auf SheX-Models auf, auf beiden Seiten
  normalisiert und ohne ILIKE-Muster. Freigegebene Steckbriefe liefert er auf Wunsch mit, gekürzt auf
  die 34 Felder, die ChatAI nutzt. `additional_info`, `account_name`, IDs und Zeitstempel des
  Snapshots gehen nie raus.

Bestehende Functions ändern sich nicht (auch `model-profile-lookup` nicht). Es gibt keine
Migration und nur SELECTs.

## Sicherheit

- Nur `POST`, nur Header `x-api-key` = Secret `CONTROLLING_MODEL_PROFILES_KEY`, zeitkonstant
  verglichen.
- Kein Bearer-Fallback, keine CORS-Header, `cache-control: no-store`.
- Ohne gesetztes Secret antwortet die Function mit 503.
- Fehlerantworten enthalten nur einen Code, Logs nur Zähler und Dauer.

## Anwenden

```bash
cd gold-reveal-next
git checkout -b feat/controlling-model-profiles
git am /pfad/zu/0001-controlling-model-profiles.patch
DENO_NO_PACKAGE_JSON=1 deno test --no-prompt supabase/functions/controlling-model-profiles   # 43 Tests
git push -u origin feat/controlling-model-profiles   # PR, Merge nach main → Lovable deployt
```

`DENO_NO_PACKAGE_JSON=1` ist nötig, weil Deno sonst die `package.json` des Frontends mitprüft.

Danach im Lovable-Projekt von SheX Coaching das Secret `CONTROLLING_MODEL_PROFILES_KEY` setzen.
Den Wert bekommt ihr von Fabio. Im Controlling-Projekt muss derselbe Wert stehen.
