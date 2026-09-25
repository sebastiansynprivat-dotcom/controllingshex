# Übergabe an ChatAI: Steckbrief-Export aus dem Controlling

Stand: 24.09.2026 · Vertrag `models-steckbrief-export.v1` · Details und Herleitung:
[`vertraege.md`](./vertraege.md) (Abschnitte B und E).

## 1. Worum es geht

Das Controlling liefert je Plattform-Konto, welches SheX-Coaching-Model („Steckbrief“) dazugehört,
ob dieser Steckbrief freigegeben ist und, wenn ja, seine freigegebene Fassung. Die Inhalte kommen
live aus SheX Coaching; das Controlling speichert keine Steckbrief-Inhalte. Der Endpunkt ersetzt für
ChatAI `model-profile-lookup` und den eigenen Geschwister-Abgleich.

`models-export` (Konten und Passwörter) bleibt unverändert und ist weiterhin die Quelle für den
Konten-Import. Der neue Endpunkt ergänzt nur Steckbrief-Informationen.

## 2. Aufruf

| | |
|---|---|
| URL | `https://kgtbciqqvctjrelgbdvx.supabase.co/functions/v1/models-steckbrief-export` |
| Methode | `GET` oder `POST` |
| Header | `x-api-key: <STECKBRIEF_EXPORT_KEY>` (nur dieser Header; kein `?key=`, kein Bearer) |
| Body (optional, POST) | `{"platform":"4Based"}` — Filter, case-insensitiv; alternativ `?platform=4Based`. Ein leerer POST-Body ist erlaubt und heißt „alle Konten“ |
| Antwort | `application/json; charset=utf-8`, `cache-control: no-store`, keine CORS-Header |

Schlüssel: liegt lokal in `~/.shex-secrets/steckbrief-export.env` (Zeilen `STECKBRIEF_EXPORT_URL`,
`STECKBRIEF_EXPORT_KEY`; 64 Zeichen, SHA-256 beginnt mit `af84041b`). Vorschlag für die ChatAI-Secrets:
`CONTROLLING_STECKBRIEF_EXPORT_URL` (Endpunkt im Client fest verdrahten, wie beim Lookup) und
`CONTROLLING_STECKBRIEF_EXPORT_KEY`. Den Schlüssel nie in Logs, Tickets oder Chat schreiben.

## 3. Antwort 200

```json
{
  "contract": "models-steckbrief-export.v1",
  "generated_at": "2026-09-24T18:00:00.000Z",
  "summary": { "accounts": 834, "approved": 700, "not_approved": 20, "missing": 114, "excluded_rows": 0 },
  "accounts": [ { "…": "je Konto eine Zeile, siehe unten" } ]
}
```

Das vollständige Beispiel mit erfundenen Daten steht in
`supabase/functions/_shared/steckbrief/fixtures/export-example.json`; es wird in den Tests gegen den
Vertrag geprüft und eignet sich als Test-Fixture für den ChatAI-Leser.

Eine freigegebene Zeile aus diesem Fixture (erfundene Daten):

```json
{
  "id": "7f64888a-4bc6-5da4-b34c-e2a1e7e386e4",
  "platform": "4Based",
  "email": "fabelstern@example.com",
  "status": "approved",
  "status_reason": "approved",
  "external_model_id": "ea839a09-dde7-574d-9bf3-4787d5dfcd6c",
  "assignment_source": "controlling",
  "assignment_updated_at": "2026-09-24T18:00:00.000Z",
  "confirmed_at": "2026-09-24T18:00:00.000Z",
  "source_updated_at": "2026-09-24T18:00:00.000Z",
  "profile": {
    "name": "Fabelstern",
    "age": "29",
    "city": "Wolkenhafen",
    "occupation": "Erfundene Tätigkeit",
    "hobbies": "Sternenkarten, Wolkensammeln",
    "languages": "Deutsch, Englisch",
    "personality": "Neugierig",
    "content_preferences": null,
    "no_gos": "Erfundene Grenze",
    "place_of_birth": "Nebeltal",
    "favorite_color": "Violett",
    "favorite_food": "Sternensuppe",
    "favorite_movie": null,
    "favorite_music": "Fiktive Klangreise",
    "dream": "Ein Wolkenhaus",
    "education": null,
    "work": "Fantasieberuf",
    "special_marks": null,
    "natural_hair": "Braun",
    "shoe_size": "39",
    "bra_size": null,
    "height": "172",
    "weight": null,
    "content_anal_fingering": false,
    "content_anal_penetration": false,
    "content_anal_plug": false,
    "content_audios_for_chat": true,
    "content_dick_ratings": false,
    "content_joi": false,
    "content_moaning_name": false,
    "content_orgasm": false,
    "content_roleplay_costumes": true,
    "content_squirting": false,
    "content_video_speaking": true
  }
}
```

### Felder je Konto (alle 11 Felder sind immer vorhanden)

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | UUID | Controlling-Zeile, dieselbe `id` wie in `models-export` |
| `platform` | `"Maloum"` \| `"Brezzels"` \| `"4Based"` | wie in `models-export` |
| `email` | string \| null | Login normalisiert (`trim` + `toLowerCase`); kann ein Benutzername ohne `@` sein; `null` = keine Login-Mail |
| `status` | `"approved"` \| `"not_approved"` \| `"missing"` | siehe Tabelle |
| `status_reason` | Enum | siehe Tabelle |
| `external_model_id` | UUID \| null | SheX-Model-ID; gesetzt bei `approved` und `not_approved`, sonst `null` |
| `assignment_source` | `"controlling"` \| `"shex_account"` \| `"same_login"` \| null | woher die Zuordnung kommt |
| `assignment_updated_at` | ISO-Zeit \| null | nur bei `assignment_source = "controlling"` |
| `confirmed_at` | ISO-Zeit \| null | Freigabezeitpunkt in SheX; nur bei `approved` |
| `source_updated_at` | ISO-Zeit \| null | `model_profiles.updated_at` in SheX; nur bei `approved` |
| `profile` | Objekt \| null | nur bei `approved`; höchstens 34 Schlüssel, siehe Abschnitt 5 |

Alle Zeitstempel: `toISOString()`-Format, UTC, 24 Zeichen (`2026-09-20T10:15:00.000Z`).

| `status` | `status_reason` | ChatAI soll |
|---|---|---|
| `approved` | `approved` | Profil übernehmen; Konto darf (bei übriger Readiness) senden |
| `not_approved` | `no_profile` | kein Profil; Model hat in SheX keinen Steckbrief |
| `not_approved` | `awaiting_approval` | kein Profil; Steckbrief nicht (mehr) freigegeben (auch „Änderung wartet auf Freigabe“) |
| `not_approved` | `profile_unusable` | kein Profil; freigegeben, aber leer/ungültig |
| `missing` | `no_login` | kein Profil; Controlling-Zeile ohne Login |
| `missing` | `blocked` | kein Profil; im Controlling bewusst gesperrt |
| `missing` | `no_assignment` | kein Profil; kein Model gefunden |
| `missing` | `ambiguous` | kein Profil; mehrere Models möglich |
| `missing` | `model_not_found` | kein Profil; zugeordnetes Model existiert in SheX nicht mehr |

Entsprechung zum bisherigen Lookup: `approved` ≈ `approved`; `not_approved/*` ≈ Lookup `missing`;
`missing/no_assignment` ≈ `not_found`; `missing/ambiguous` ≈ `ambiguous_account`.

## 4. Fehler

Fehlerantworten enthalten nur `{"error":"<code>"}`, nie Daten.

| HTTP | `error` | Bedeutung | ChatAI soll |
|---|---|---|---|
| 400 | `invalid_request` | Filter/Body ungültig | Aufruf korrigieren, kein Retry |
| 401 | `unauthorized` | Schlüssel fehlt oder falsch | Lauf abbrechen, Konfiguration prüfen, kein Retry |
| 405 | `method_not_allowed` | nicht GET/POST | Aufruf korrigieren |
| 500 | `internal_error` | Datenbankfehler im Controlling | letzten Stand behalten, später erneut |
| 500 | `inventory_incomplete` | Bestand nicht vollständig geladen | letzten Stand behalten, später erneut |
| 502 | `upstream_failed` | SheX Coaching nicht erreichbar oder Antwort ungültig | letzten Stand behalten, später erneut |
| 503 | `not_configured` | Noch nicht fertig eingerichtet: ein Secret fehlt, der SheX-Endpunkt ist nicht ausgerollt oder die Tabelle fehlt | letzten Stand behalten; Betrieb informieren |

Es gibt **nie ein Teilergebnis**: Entweder kommt 200 mit allen Konten, oder ein Fehler ohne Konten.
Ein Fehler darf nie als „kein Steckbrief“ gewertet werden.

## 5. `profile`

- Enthält ausschließlich diese Schlüssel aus der freigegebenen SheX-Fassung (`approved_snapshot`),
  Werte unverändert, in dieser Reihenfolge: `name, age, city, occupation, hobbies, languages, personality,
  content_preferences, no_gos, place_of_birth, favorite_color, favorite_food, favorite_movie,
  favorite_music, dream, education, work, special_marks, natural_hair, shoe_size, bra_size, height,
  weight, content_anal_fingering, content_anal_penetration, content_anal_plug,
  content_audios_for_chat, content_dick_ratings, content_joi, content_moaning_name, content_orgasm,
  content_roleplay_costumes, content_squirting, content_video_speaking`.
- Das ist genau die Allowlist von `supabase/functions/_shared/profile/legacyMapper.ts`. Deshalb kann
  `mapLegacyApprovedProfile(profile, { accountEmail: email })` den Wert unverändert verarbeiten.
  Nur der Diagnosezähler `ignoredSourceKeyCount` fällt kleiner aus.
- `null` bedeutet „in SheX leer“ (für `remoteNullTargets` relevant). Ein fehlender Schlüssel heißt,
  dass er in der Fassung nicht vorkommt.
- Messung vom 24.09. über die heute 532 freigegebenen Steckbriefe (nachgebaute Mapper-Regeln):
  - 0 würden komplett verworfen.
  - Bei 176 ist `age` nicht lesbar und entfällt.
  - Bei 17 ist `content_preferences` länger als 400 Bytes und entfällt.

## 6. Anforderungen an den ChatAI-Leser

1. **Eigener, begrenzter Decoder.** `lookupClient.ts` passt nicht: fest verdrahtete URL, anderes
   Antwortformat, Limit 128 KiB.
   - Antwortgröße bis 8 MiB zulassen. Erwartet sind etwa 1,4 MB, im schlimmsten Fall etwa 5,2 MB bei
     834 Konten.
   - `content-type` prüfen; `contract` muss `models-steckbrief-export.v1` sein.
   - Unbekannte zusätzliche Felder ignorieren. Eine unbekannte `contract`-Version, fehlende
     Pflichtfelder oder falsche Typen führen dazu, dass der ganze Lauf verworfen wird.
2. **Zeitbudget.** Gesamt-Timeout mindestens 90 s. Das Controlling ruft SheX mit 20 s je Versuch
   und einer Wiederholung auf. Bei Netzfehlern, 500, 502 und 503 höchstens eine Wiederholung nach
   einigen Sekunden, sonst bis zum nächsten Lauf warten.
3. **Zuordnung zu ChatAI-Konten** über `(platform, email)`, wie die Controlling-Markierung im
   Tages-Sync. Zeilen, deren `email` kein `@` enthält, wie bisher über `provider_username` derselben
   Plattform abgleichen. Brezzels wird genauso behandelt wie Maloum und 4Based.
4. **Drei ID-Räume nicht vermischen:**
   - `id` = Controlling-Zeile
   - `external_model_id` = SheX-Model
   - ChatAIs lokale `provider_accounts.model_id` wird nie umgehängt
5. **Dubletten.** Mehrere Zeilen mit derselben `(platform, email)` tragen immer denselben Status und
   denselben Inhalt; einmal anwenden reicht.
6. **Reihenfolge und Frische.** `generated_at` ist der Beginn der Anfrage. Die Daten sind mindestens so
   frisch. Einen Export nur anwenden, wenn sein `generated_at` neuer ist als der des zuletzt
   angewandten. So kann ein langsamer, älterer Lauf keinen neueren überschreiben. Liegt der letzte erfolgreiche Export mehr als 24 h zurück, keine neuen
   Konten zum Senden freischalten.
7. **Negative Ergebnisse gelten auch rückwirkend.** Wird ein zuvor `approved` Konto `not_approved`
   oder `missing`, soll ChatAI das alte Profil nicht weiter als freigegeben behandeln. Ob
   `send_enabled` dann sofort fällt, entscheidet ChatAI; empfohlen ist, es fallen zu lassen.
8. **Eine Quelle.** Für Konten, die im Export stehen, entfallen `model-profile-lookup` und der
   Geschwister-Abgleich. Die Regel „gleiche Login-Mail“ steckt bereits im Export
   (`assignment_source = "same_login"`), inklusive der manuellen Zuordnungen aus dem Controlling.
   Ein zusätzlicher ChatAI-Abgleich würde diese Zuordnungen überschreiben.
9. **Konten ohne Exportzeile.** Konten, die in `models-export` stehen, aber nicht im Steckbrief-Export,
   haben keinen Steckbrief. Das Controlling zählt sie nur als `summary.excluded_rows`; sie gehören
   keinem Admin-Besitzer.

## 7. Umstellung (Schattenbetrieb, dann Umschalten)

1. Leser bauen und nur lesend neben dem bisherigen Lookup laufen lassen; nichts schreiben.
2. **Je Identität** `(platform, email)` vergleichen, nicht nur in Summe:
   - `external_model_id` gegen den heutigen Model-Bezug
   - `status` gegen den heutigen `profile_lookup_status`
   - Mapper-Ergebnis (Felder, `remoteNullTargets`, Mapping-Fehler)

   Erwartete Unterschiede:
   - Konten, die heute nur über den ChatAI-Geschwister-Abgleich laufen, erscheinen als `same_login`.
   - Manuelle Zuordnungen aus dem Controlling (`controlling`) sind neu; heute fehlen etwa 86 Konten
     völlig in SheX.
3. Umschalten, wenn jeder Unterschied erklärt ist. Danach Lookup-Aufrufe und den Geschwister-Abgleich
   für diese Konten entfernen.
4. Referenzwerte vom 24.09. (bisheriger Lookup, 817 Identitäten):
   - 532 approved, 271 not_found, 14 missing.
   - Von den 271 hatten 176 ein Geschwisterkonto mit derselben Mail; 173 davon waren freigegeben.
