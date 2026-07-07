## Ziel

Statt nur zwei Schwellen (on-track / off-track) gibt es **fünf Stretch-Stufen** basierend auf der prozentualen Zielerreichung der letzten abgeschlossenen Woche. Damit kannst du feiner steuern: klare Overperformer stärker pushen, knappe Fälle sanft, klare Underperformer entlasten — ohne dass ein einzelner schlechter Ausrutscher einen sonst starken Chatter direkt in den Malus wirft.

## Die 5 Buckets

Berechnung: `achievementPct = actual_revenue / target_revenue` aus dem letzten `weekly_goal_results`-Eintrag pro Chatter.

| Bucket | Bereich | Default-Stretch | Bedeutung |
|---|---|---|---|
| **Star** | ≥ 130% | 125% | Klar übererfüllt → stärker pushen |
| **Strong** | 110–130% | 115% | Solide drüber → moderat pushen |
| **On-Track** | 90–110% | 105% | Ziel getroffen → leicht drüber |
| **Close** | 70–90% | 95% | Knapp verfehlt → sanft senken |
| **Off-Track** | < 70% | 85% | Klar verfehlt → deutlich entlasten |

Alle 5 Werte frei einstellbar (80–200%). Neue Chatter ohne Historie → **On-Track** als Default.

## Speicherung (`settings`-Tabelle)

Neue Keys:
- `weekly_goal_stretch_star_pct`
- `weekly_goal_stretch_strong_pct`
- `weekly_goal_stretch_on_track_pct`
- `weekly_goal_stretch_close_pct`
- `weekly_goal_stretch_off_track_pct`

Fallback-Kette beim Laden: neue Keys → alte 2-Schwellen-Keys (`_on_track_pct` / `_off_track_pct`) → Legacy `weekly_goal_stretch_pct` → Defaults.

## UI

**Einstellungs-Popover** (in `WeeklyGoals.tsx`):
- 5 Zahlenfelder untereinander mit Label + Range-Hinweis (z.B. „Star (≥130%)").
- Kurzer Info-Text: „Faktor bestimmt sich pro Chatter automatisch aus der letzten abgeschlossenen Woche."

**Chatter-Vorschlags-Karte**:
- Kleines Badge mit Bucket-Name + Faktor, z.B. `Star ×1,25` / `Close ×0,95`.
- Farbcode: Star/Strong = grünlich, On-Track = neutral, Close = amber, Off-Track = rot-gedämpft.
- Neue Chatter → Badge `Neu ×1,05`.

**Info-Text unter Chatter-Liste** aktualisiert:
„Vorschlag = Σ Model-Ø × 7 Tage × Stretch (5 Stufen nach letzter Woche, anpassbar)".

## Klassifikations-Logik

Pro Vorschlags-Rendering ein zusätzlicher Query auf `weekly_goal_results`:
- Alle Zeilen der laufenden User/Platform, sortiert nach `week_start DESC`.
- Pro `chatter_name` den neuesten Eintrag nehmen (client-seitig gruppieren).
- `achievementPct = actual / target` → Bucket bestimmen → Faktor auflösen.

Bereits vorhandene Vorschlags-Formel bleibt unverändert:
```text
raw = perChatterDailyBaseline × 7 × stretchFactor(chatter)
suggested = round10(raw)
```

## Was gebaut wird

**`src/pages/WeeklyGoals.tsx`**
- State: `stretchStar/Strong/OnTrack/Close/OffTrack` (+ Draft-Varianten fürs Popover).
- Settings-Load: 5 neue Keys mit Fallback-Kette.
- Settings-Save: 5 neue Keys schreiben.
- Neuer Query beim Vorschlags-Aufbau: letzter `weekly_goal_results` pro Chatter.
- Neue Helper: `bucketFor(pct)` → `'star'|'strong'|'on_track'|'close'|'off_track'|'new'` und `stretchFactorFor(chatter)`.
- Popover: 5 Felder statt aktuell 1.
- Karte: Bucket-Badge mit Faktor.

**Keine Änderungen an**
- `src/lib/weekly-goals.ts` (`suggestWeeklyFromModels` nimmt Stretch weiter als Parameter).
- Monatsziel-Logik, Progress-Berechnung, DB-Schema.

## Beispiel

Defaults: Star 125 / Strong 115 / On-Track 105 / Close 95 / Off-Track 85.
Baseline 100 €/Tag → 700 €/Woche unstretched.

- **A** letzte Woche 145% erreicht → Star → 700 × 1,25 = **875 €**
- **B** 118% → Strong → **805 €**
- **C** 95% → On-Track → **735 €**
- **D** 78% → Close → **665 €**
- **E** 55% → Off-Track → **595 €**
- **F** neu → On-Track-Default → **735 €**
