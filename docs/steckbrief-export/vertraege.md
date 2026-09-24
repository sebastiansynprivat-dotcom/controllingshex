# Steckbrief-Export — verbindliche Verträge v1

Stand: 24.09.2026. Diese Datei ist die einzige Quelle für die Schnittstellen zwischen
SheX Coaching, dem Controlling und ChatAI. Code, Tests und Übergabe richten sich danach.

## 0. Begriffe und gemeinsame Regeln

- **Controlling**: Supabase-Projekt `kgtbciqqvctjrelgbdvx`, Repository `controllingshex`.
  Tabelle `public.models` (`id` uuid, `platform` text mit CHECK `Maloum` | `Brezzels` | `4Based`,
  `model_name` text, `email` text oder null, `user_id` uuid oder null, …).
- **SheX Coaching** („SheX“): Supabase-Projekt `acznyhzgbkdcmnbqvptt`, Repository `gold-reveal-next`.
  Tabellen `public.models` (`id`, `name`, `username`, `model_active`, …), `public.accounts`
  (`id`, `model_id`, `platform` = Anzeige-Label, `account_email` = Rohwert) und
  `public.model_profiles` (`model_id` eindeutig, `confirmed_at`, `updated_at`, `approved_snapshot` jsonb, …).
- **Konto-Identität**: `(platform, normalizeLogin(email))`.
- `normalizeLogin(s)`: bei einem String `s.trim().toLowerCase()`, leeres Ergebnis → `null`;
  alles andere → `null`. Genau JavaScripts `String.prototype.trim` und `toLowerCase`.
- `platformKey(label)`: `label.trim().toLowerCase().replace(/[^a-z0-9]/g, "")`.
  Beispiele: `4Based` → `4based`, `Maloum` → `maloum`, `Brezzels` → `brezzels`.
- **PROFILE_KEYS**: genau diese 34 Schlüssel, in dieser Reihenfolge (entspricht der Allowlist von
  ChatAIs `legacyMapper.ts`):
  `name, age, city, occupation, hobbies, languages, personality, content_preferences, no_gos,
  place_of_birth, favorite_color, favorite_food, favorite_movie, favorite_music, dream, education,
  work, special_marks, natural_hair, shoe_size, bra_size, height, weight,
  content_anal_fingering, content_anal_penetration, content_anal_plug, content_audios_for_chat,
  content_dick_ratings, content_joi, content_moaning_name, content_orgasm,
  content_roleplay_costumes, content_squirting, content_video_speaking`
- `projectProfile(snapshot)`: neues Objekt. Für jeden Schlüssel `K` aus PROFILE_KEYS (in Reihenfolge):
  wenn `snapshot` `K` als eigene Eigenschaft hat, `out[K] = snapshot[K]`. Der Wert bleibt
  unverändert, auch `null`. Fehlende Schlüssel bleiben weg, alle anderen Schlüssel entfallen.
- **Freigabestatus eines Models** (entspricht SheX `model-profile-lookup`):
  - keine `model_profiles`-Zeile → `none`
  - Zeile mit `confirmed_at = null` → `not_approved` (auch „Änderung wartet auf Freigabe“ und
    „Freigabe zurückgezogen“)
  - `confirmed_at` gesetzt und `approved_snapshot` ist ein JSON-Objekt (kein Array) mit mindestens
    einem eigenen Schlüssel → `approved`
  - `confirmed_at` gesetzt, Snapshot fehlt, ist leer oder kein Objekt → `unusable`
- **Zeitstempel** in allen Antworten: `new Date(wert).toISOString()` (UTC, 24 Zeichen), sonst `null`.
- **Datenschutz** für alle drei Endpunkte: keine Mails, IDs, Namen oder Steckbrief-Werte in Logs
  oder Fehlerantworten. Höchstens eine Logzeile je Anfrage mit Funktionsname, HTTP-Status,
  Zählern und Dauer. Fehlerantworten enthalten nur `{"error":"<code>"}`.

## A. SheX: Function `controlling-model-profiles` (Repository gold-reveal-next)

- URL: `https://acznyhzgbkdcmnbqvptt.supabase.co/functions/v1/controlling-model-profiles`
- `supabase/config.toml`: `verify_jwt = false`
- Nur `POST`. Jede andere Methode (auch `OPTIONS`) → 405 `method_not_allowed`. Keine CORS-Header.
- Auth: Secret `CONTROLLING_MODEL_PROFILES_KEY` (getrimmt). Fehlt es oder ist es leer →
  503 `not_configured`. Header `x-api-key` (getrimmt) muss gleich sein; der Vergleich läuft
  zeitkonstant über SHA-256-Digests. Fehlt der Header oder passt er nicht → 401 `unauthorized`.
  Kein Bearer-Fallback, kein Query-Parameter. Die Auth-Prüfung läuft vor dem Body-Parsing.
- Body: JSON-Objekt, höchstens 1 MiB (sonst 413 `payload_too_large`). Ungültiges JSON oder
  ungültige Form → 400 `invalid_request`. Mehr als 1000 Einträge in einer Liste → 400 `too_many_items`.
- Prüfreihenfolge: Methode (405) → Secret fehlt (503) → `x-api-key` (401) → Größe (413) → Body (400).
- Antwort-Header: `content-type: application/json; charset=utf-8`, `cache-control: no-store`.
- Unerwartete Fehler → 500 `internal_error`, ohne Datenbanktext.

### A1. `{"action":"list_models"}`

Antwort 200:

```json
{
  "contract": "controlling-model-profiles.v1",
  "models": [
    { "model_id": "uuid", "name": "Lena", "username": "lena_x", "model_active": true,
      "profile_status": "approved" }
  ]
}
```

- Alle Zeilen aus `public.models`, sortiert nach `name` (`localeCompare(…, "de")`), dann `model_id`.
  Das Controlling prüft die Reihenfolge nicht, weil die Sortierung zwischen Laufzeiten abweichen darf.
- `profile_status` nach der Freigabe-Regel oben: `approved` | `not_approved` | `none` | `unusable`.
- Keine Mails, keine Steckbrief-Inhalte.

### A2. `{"action":"resolve", "identities": [...], "model_ids": [...], "include_profiles": true}`

- `identities`: Array (darf leer sein), höchstens 1000 Einträge, je `{ "platform": string 1–32 Zeichen,
  "email": string 1–320 Zeichen }`.
- `model_ids`: Array (darf leer sein), höchstens 1000 UUIDs; Groß-/Kleinschreibung egal, Ausgabe
  in Kleinbuchstaben.
- `include_profiles`: boolean, optional, Standard `false`. Unbekannte Felder werden ignoriert.
- Zuordnung: alle `public.accounts` (`id, model_id, platform, account_email`) seitenweise laden.
  Zeilen ohne `model_id` oder ohne Mail ignorieren. Pro Identität:
  `pk = platformKey(platform)`, `e = normalizeLogin(email)`.
  - `same_platform_model_ids`: sortierte, eindeutige `model_id` aller Konten mit
    `platformKey(account.platform) === pk` und `normalizeLogin(account.account_email) === e`.
  - `other_platform_model_ids`: sortierte, eindeutige `model_id` aller Konten mit gleicher
    normalisierter Mail und anderem `platformKey`.
  - Ist `e` `null`, sind beide Listen leer.
  - Der Vergleich ist wörtlich, ohne ILIKE und ohne Muster.

Antwort 200:

```json
{
  "contract": "controlling-model-profiles.v1",
  "resolutions": [
    { "platform": "4based", "email": "lena@example.com",
      "same_platform_model_ids": ["uuid"], "other_platform_model_ids": [] }
  ],
  "profiles": [
    { "model_id": "uuid", "model_exists": true, "profile_status": "approved",
      "confirmed_at": "2026-09-20T10:15:00.000Z", "updated_at": "2026-09-20T10:14:12.000Z",
      "profile": { "name": "Lena", "age": "24" } }
  ]
}
```

- `resolutions`: gleiche Länge und Reihenfolge wie `identities`; `platform` = `pk`,
  `email` = `e` oder `""`.
- `profiles`: genau ein Eintrag je eindeutiger ID aus (allen IDs in `resolutions`) ∪ (`model_ids`),
  aufsteigend nach `model_id` sortiert.
  - `model_exists`: ID existiert in `public.models`. Wenn nicht: `profile_status = "none"`,
    Zeitstempel und `profile` sind `null`.
  - `confirmed_at` / `updated_at` (`model_profiles.updated_at`): nur bei `approved`, sonst `null`.
  - `profile`: nur bei `approved` und `include_profiles === true`: `projectProfile(approved_snapshot)`,
    sonst `null`.

## B. Controlling: Function `models-steckbrief-export` (für ChatAI)

- URL: `https://kgtbciqqvctjrelgbdvx.supabase.co/functions/v1/models-steckbrief-export`
- `supabase/config.toml`: `verify_jwt = false`
- Methoden: `GET` und `POST`. Alles andere (auch `OPTIONS`) → 405 `method_not_allowed`.
  Keine CORS-Header.
- Secrets: `STECKBRIEF_EXPORT_KEY` (Zugang für ChatAI), `CONTROLLING_MODEL_PROFILES_KEY`
  (Aufruf von A).
  - Fehlt `STECKBRIEF_EXPORT_KEY` → 503 `not_configured`, noch vor der Auth-Prüfung.
  - Danach Auth: nur Header `x-api-key`, zeitkonstant verglichen. Fehlt der Header oder passt er
    nicht → 401 `unauthorized`.
  - Danach: fehlt `CONTROLLING_MODEL_PROFILES_KEY` → 503 `not_configured`.
  - `?key=`, `Authorization`, `MODELS_EXPORT_KEY` und `LIVE_STATUS_KEY` werden nie akzeptiert.
- Prüfreihenfolge: Methode (405) → `STECKBRIEF_EXPORT_KEY` fehlt (503) → `x-api-key` (401) →
  `CONTROLLING_MODEL_PROFILES_KEY` fehlt (503) → Parameter/Body (400).
- Optionaler Filter `platform`: als Query-Parameter oder im JSON-Body (`POST`). Ein String mit
  1–32 Zeichen, verglichen case-insensitiv mit `models.platform`. Ungültiger Body oder Typ →
  400 `invalid_request`. Eine unbekannte Plattform ergibt eine leere Liste mit 200.
  Ein leerer `POST`-Body gilt wie bei `models-export` als „kein Filter“. Stehen beide Angaben da,
  gilt die im Body.
- Die Auflösung läuft immer über den gesamten vertrauenswürdigen Bestand; der Filter wirkt erst
  auf die Ausgabe.
- Antwort-Header: `content-type: application/json; charset=utf-8`, `cache-control: no-store`.
- Fehler: 500 `internal_error`; 500 `inventory_incomplete` (geladene Zeilen ≠ Zählung);
  502 `upstream_failed` (A nicht erreichbar, Timeout, Nicht-200 oder Vertragsverletzung).
  **Nie ein Teilergebnis.**

Antwort 200:

```json
{
  "contract": "models-steckbrief-export.v1",
  "generated_at": "2026-09-24T18:00:00.000Z",
  "summary": { "accounts": 3, "approved": 1, "not_approved": 1, "missing": 1, "excluded_rows": 0 },
  "accounts": [
    {
      "id": "uuid",
      "platform": "4Based",
      "email": "lena@example.com",
      "status": "approved",
      "status_reason": "approved",
      "external_model_id": "uuid",
      "assignment_source": "controlling",
      "assignment_updated_at": "2026-09-24T16:05:12.000Z",
      "confirmed_at": "2026-09-20T10:15:00.000Z",
      "source_updated_at": "2026-09-20T10:14:12.000Z",
      "profile": { "name": "Lena" }
    }
  ]
}
```

- `accounts`: eine Zeile je vertrauenswürdiger `models`-Zeile (Abschnitt D), in der Reihenfolge
  `platform`, `model_name`, `id` wie in der Datenbank. Alle 11 Felder sind immer vorhanden.
- `summary` zählt die ausgegebenen Zeilen. `excluded_rows` zählt die nicht vertrauenswürdigen
  Zeilen, die auf den Filter passen.
- Feldbedeutung:
  - `email`: `normalizeLogin(models.email)`, kann ein Benutzername ohne `@` sein.
  - `external_model_id`: SheX-Model-ID. Gesetzt bei `approved` und `not_approved`, sonst `null`.
  - `assignment_source`: `controlling` | `shex_account` | `same_login` | `null`.
  - `assignment_updated_at`: nur bei `assignment_source = "controlling"`, sonst `null`.
  - `confirmed_at`, `source_updated_at`, `profile`: nur bei `approved`, sonst `null`.
    `profile` = `projectProfile`.

Zuordnung von Status und Grund:

| `status` | `status_reason` | Bedeutung |
|---|---|---|
| `approved` | `approved` | Model zugeordnet, Steckbrief freigegeben, `profile` gesetzt |
| `not_approved` | `no_profile` | Model zugeordnet, in SheX gibt es keinen Steckbrief |
| `not_approved` | `awaiting_approval` | Steckbrief nicht (mehr) freigegeben |
| `not_approved` | `profile_unusable` | freigegeben, aber Snapshot leer oder ungültig |
| `missing` | `no_login` | Zeile ohne Login-Mail |
| `missing` | `blocked` | im Controlling auf „kein Steckbrief“ gesetzt |
| `missing` | `no_assignment` | weder Controlling, SheX-Konto noch gleiche Login-Mail |
| `missing` | `ambiguous` | mehrere mögliche Models, Auswahl fehlt |
| `missing` | `model_not_found` | zugeordnetes Model existiert in SheX nicht (mehr) |

## C. Controlling: Function `steckbrief-links` (für die Oberfläche)

- Kein Eintrag in `config.toml` (Gateway prüft das JWT). CORS wie bei den übrigen App-Functions
  (`Access-Control-Allow-Origin: *`; Header `authorization, x-client-info, apikey, content-type`;
  Methoden `POST, OPTIONS`). `OPTIONS` → 200 `ok`.
- Nur `POST` mit Body `{"action":"overview"}`. Andere Aktionen oder Methoden →
  400 `invalid_request` bzw. 405 `method_not_allowed`.
- Auth, in dieser Reihenfolge:
  - `Authorization: Bearer <User-JWT>` → `auth.getUser`. Kein oder ungültiges Token →
    401 `unauthorized`.
  - Der Nutzer braucht die Rolle `admin` in `public.user_roles`, sonst 403 `forbidden`.
  - Fehlt `CONTROLLING_MODEL_PROFILES_KEY` → 503 `not_configured`.
- Prüfreihenfolge: `OPTIONS` (200) → Methode ≠ `POST` (405) → Token (401) → Rolle (403) →
  Secret (503) → Body (400).
- Lädt den Bestand wie B, ruft A mit `resolve` (`include_profiles: false`) und `list_models` auf.
  Fehler wie in B.

Antwort 200:

```json
{
  "contract": "steckbrief-links.overview.v1",
  "generated_at": "2026-09-24T18:00:00.000Z",
  "excluded_rows": 0,
  "models": [
    { "model_id": "uuid", "name": "Lena", "username": null, "model_active": true,
      "profile_status": "approved" }
  ],
  "identities": [
    {
      "platform": "4Based",
      "email": "lena@example.com",
      "status": "approved",
      "status_reason": "approved",
      "external_model_id": "uuid",
      "assignment_source": "shex_account",
      "assignment_updated_at": null,
      "confirmed_at": "2026-09-20T10:15:00.000Z",
      "override": null,
      "shex_model_ids": ["uuid"]
    }
  ],
  "orphan_overrides": [
    { "platform": "Maloum", "email": "alt@example.com", "mode": "assign", "external_model_id": "uuid",
      "external_model_name": "Mia", "updated_at": "2026-09-01T09:00:00.000Z" }
  ]
}
```

- `models`: unverändert aus A1.
- `identities`: je eindeutiger vertrauenswürdiger Identität mit Login-Mail ein Eintrag, sortiert
  nach `platform`, dann `email`. Status, Grund und Quelle wie in B.
- `override`: `{mode, external_model_id, external_model_name, updated_at}` oder `null`.
- `shex_model_ids`: `same_platform_model_ids` aus A. Dient der Anzeige, wenn eine Ausnahme von SheX
  abweicht.
- `orphan_overrides`: Ausnahmen, zu denen keine vertrauenswürdige `models`-Zeile passt.
- Nie Steckbrief-Inhalte.

## D. Controlling: Tabelle `public.model_steckbrief_links` und vertrauenswürdiger Bestand

Eine Zeile je Konto-Identität, nur für **Ausnahmen**:

| Spalte | Typ | Regel |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `platform` | text not null | CHECK `Maloum` \| `Brezzels` \| `4Based` |
| `email_normalized` | text not null | nicht leer, `= lower(…)`, `= btrim(…)` |
| `mode` | text not null | CHECK `assign` \| `block` |
| `external_model_id` | uuid | bei `assign` Pflicht, bei `block` NULL (CHECK) |
| `external_model_name` | text | Anzeige-Cache, nicht maßgeblich |
| `created_by` | uuid | default `auth.uid()` |
| `created_at`, `updated_at` | timestamptz | default `now()`, Trigger `update_updated_at_column` |

- `UNIQUE (platform, email_normalized)`.
- RLS aktiv. SELECT/INSERT/UPDATE/DELETE für `authenticated` nur mit
  `public.has_role(auth.uid(), 'admin')`; `service_role` hat vollen Zugriff; `anon` nichts.
- **Vertrauenswürdiger Bestand**: nur `models`-Zeilen, deren `user_id` die Rolle `admin` hat. Die übrigen
  Zeilen erscheinen weder in B noch in C. Sie zählen nur als `excluded_rows`.
- Laden von `models`, Ausnahmen und Admin-Rollen seitenweise (1000 je Seite, stabile Sortierung).
  Stimmt die geladene Menge nicht mit der Zählung überein → `inventory_incomplete`.

## E. Auflösung einer Konto-Identität (Controlling, gilt für B und C)

Für die Identität `(P, e)` einer vertrauenswürdigen Zeile, wobei `e` nicht `null` ist:

1. **Ausnahme im Controlling** für `(P, e)`:
   - `block` → `missing` / `blocked`, Quelle `controlling`
   - `assign` → Model = `external_model_id`, Quelle `controlling`
2. Sonst **SheX-Konto**: `same_platform_model_ids` für `(platformKey(P), e)`:
   - genau eine ID → dieses Model, Quelle `shex_account`
   - mehrere → `missing` / `ambiguous`
   - keine → weiter mit Stufe 3
3. Sonst **gleiche Login-Mail**: Kandidaten = `other_platform_model_ids` für `(P, e)` ∪ das Model
   jeder anderen vertrauenswürdigen Identität `(P2, e)` mit `P2 ≠ P`, sofern dort Stufe 1 (`assign`)
   oder Stufe 2 genau ein Model ergab. Nicht transitiv: Stufe-3-Ergebnisse anderer Identitäten zählen
   nicht, `block` und `ambiguous` tragen nichts bei.
   - genau eine ID → dieses Model, Quelle `same_login`
   - mehrere → `missing` / `ambiguous`
   - keine → `missing` / `no_assignment`
4. Ist ein Model bestimmt, gilt dessen Profil aus A:
   - fehlt der Eintrag in `profiles` → Vertragsverletzung → 502
   - `model_exists = false` → `missing` / `model_not_found`; `external_model_id = null`, die Quelle
     bleibt erhalten
   - `none` → `not_approved` / `no_profile`
   - `not_approved` → `not_approved` / `awaiting_approval`
   - `unusable` → `not_approved` / `profile_unusable`
   - `approved` → `approved` / `approved`. In B muss `profile` ein Objekt sein, sonst 502.
     B wendet `projectProfile` erneut an.

Zeilen ohne Login-Mail: `missing` / `no_login`, Quelle `null`.
Dubletten (gleiche Identität) bekommen immer dasselbe Ergebnis.
