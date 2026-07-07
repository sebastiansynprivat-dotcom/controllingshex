
## Ziel

Statt einem globalen Stretch-Faktor (aktuell 110%) gibt es **zwei getrennt konfigurierbare Schwellen**, die pro Chatter automatisch angewendet werden — je nachdem, ob er in der letzten abgeschlossenen Woche **on track** oder **off track** war. Damit steuerst du selbst, wie hart Overperformer gepusht und wie sanft Underperformer entlastet werden.

## So funktioniert es

### Zwei Stretch-Werte statt einem

In den Wochenziel-Einstellungen (dort wo aktuell das eine „Stretch %"-Feld liegt) wird das Feld ersetzt durch:

- **Stretch On-Track** (Default 115%) — wird auf Chatter angewendet, deren letzte abgeschlossene Woche `on_track` oder `close` war.
- **Stretch Off-Track** (Default 95%) — wird auf Chatter angewendet, deren letzte abgeschlossene Woche `off_track` war.
- **Neuer Chatter (noch keine Woche)** → nutzt Stretch On-Track als Default (konfigurierbar via kleines Toggle: "Neue behandeln wie On-Track").

Beide Werte sind frei einstellbar (80–200%), werden wie bisher in `settings` gespeichert unter neuen Keys:
- `weekly_goal_stretch_on_track_pct`
- `weekly_goal_stretch_off_track_pct`

Fallback: falls nur der alte Key `weekly_goal_stretch_pct` existiert → für beide neuen Werte übernehmen (Migration ohne DB-Änderung).

### Klassifikation pro Chatter

Für jeden Chatter wird beim Generieren des Vorschlags die **letzte abgeschlossene Woche** aus `weekly_goal_results` gelesen:

- Letzter Eintrag mit `status = 'on_track'` oder `'close'` → nutzt On-Track-Stretch.
- Letzter Eintrag mit `status = 'off_track'` → nutzt Off-Track-Stretch.
- Kein Eintrag vorhanden → Default (siehe oben).

### Vorschlag-Formel bleibt gleich, nur der Faktor variiert

```text
raw = perChatterDailyBaseline × 7 × stretchFactor(chatter)
suggested = round10(raw)
```

Alle anderen Regeln (Smoothing über N Tage, „eigene Performance schlägt Model-Ø falls deutlich drüber") bleiben unverändert — dort wird `stretchFactor` einfach nach Chatter aufgelöst.

### UI-Änderungen

- Im Einstellungs-Popover: zwei Zahlenfelder nebeneinander mit Labels **„On-Track %"** und **„Off-Track %"**, plus kurze Erklärung.
- Auf jeder Chatter-Vorschlag-Karte: kleines Badge **„On-Track ×1,15"** bzw. **„Off-Track ×0,95"**, damit du auf einen Blick siehst, welcher Faktor angewendet wurde und warum.
- Info-Text unter der Chatter-Liste aktualisiert: „Vorschlag = Σ Model-Ø × 7 Tage × Stretch (115% on-track / 95% off-track, anpassbar)".

## Was gebaut wird

**`src/pages/WeeklyGoals.tsx`**
- `stretchPct` → aufgeteilt in `stretchOnTrackPct` + `stretchOffTrackPct` (jeweils State + Draft).
- Settings-Load erweitert um beide neuen Keys, mit Fallback auf Legacy-Key.
- Settings-Save schreibt beide neuen Keys.
- Beim Aufbau der Vorschlagsliste: pro Chatter letzten `weekly_goal_results.status` laden (1 zusätzlicher Query, gruppiert nach chatter_name, order by week_start desc limit 1 per group) → `stretchFactorFor(chatter)` bestimmt On/Off.
- Popover-UI: 2 Felder statt 1.
- Chatter-Karte: Badge mit angewandtem Faktor.

**Keine Änderungen an**
- `src/lib/weekly-goals.ts` (`suggestWeeklyFromModels` nimmt den Stretch bereits als Parameter — der Aufrufer entscheidet).
- Monatsziel-Logik.
- `computeWeekProgress` / Status-Berechnung.
- DB-Schema (nur zwei neue Rows in bestehender `settings`-Tabelle).

## Beispiel

Einstellungen: On-Track 120%, Off-Track 90%.

- **Chatter A** — Vorwoche on_track, Model-Baseline 100€/Tag → Vorschlag = 100 × 7 × 1,20 = **840€** (Badge: On-Track ×1,20).
- **Chatter B** — Vorwoche off_track, Baseline 100€/Tag → Vorschlag = 100 × 7 × 0,90 = **630€** (Badge: Off-Track ×0,90).
- **Chatter C** — neu, keine Historie → On-Track-Default, Vorschlag = 840€.

So kannst du die zwei Schwellen frei kalibrieren, bis die Verteilung on/off/close in der Praxis sinnvoll aussieht.
