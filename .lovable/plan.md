

## Game-Changer Feature: **Revenue Recovery Queue**

### Die Idee in einem Satz
Eine permanent oben im Dashboard sitzende Liste, die jeden Tag exakt sagt: **"Diese 3–5 Chatter, wenn du sie heute auf ihren eigenen 30-Tage-Schnitt zurückbringst, holen €X Umsatz rein."** — mit konkretem €-Betrag, der direkt erreichbar ist.

### Warum das den Umsatz wirklich pusht
Die App zeigt aktuell viele Signale (Frühwarnung, Anomalien, Kategorien, Swap-Tracking) — aber keine davon beantwortet die einzige Frage, die zählt:

> *"Wenn ich heute nur 30 Minuten habe — wo lege ich sie hin, damit am meisten Umsatz reinkommt?"*

Das ist kein weiteres Alert-Panel. Es ist eine **priorisierte Aktionsliste mit hartem Euro-Wert** pro Eintrag. Der Underperformer mit dem höchsten Recovery-Potenzial steht oben — nicht der lauteste Alert.

### Wie das Recovery-Potenzial berechnet wird (kein Bullshit, nur Mathe auf vorhandenen Daten)

Pro Chatter aus `chatter_history` der letzten 30 Tage:

```text
baseline      = Median(revenue_today) der letzten 30 Tage, ohne 0€-Tage
current_avg   = Durchschnitt der letzten 3 Tage
gap           = baseline - current_avg          (nur wenn > 0)
confidence    = Anzahl Tage mit Daten / 30
recovery_eur  = gap * 7 * confidence            (1-Wochen-Hochrechnung)
```

Sortiert wird nach `recovery_eur` absteigend. Nur Chatter angezeigt, bei denen:
- `gap > 15%` vom Baseline
- `recovery_eur >= 50 €` (sonst nicht relevant)
- Letzter Datenpunkt ≤ 2 Tage alt (nicht abwesend)

So entstehen typischerweise 3–7 Einträge pro Tag — keine endlose Liste.

### Wie es aussieht

Premium-Karte ganz oben im Dashboard, direkt unter der Suche, **vor** ForecastBanner und AlertCockpit:

```text
┌─────────────────────────────────────────────────────────────┐
│  REVENUE RECOVERY            Heute erreichbar: +1.840 €     │
│  ─────────────────────────────────────────────────────────  │
│  1  Lena_M       Schnitt 240€ → aktuell 95€    +1.015 € ›  │
│  2  Sarah_K      Schnitt 180€ → aktuell 110€     +490 € ›  │
│  3  Mia_B        Schnitt 95€  → aktuell 40€      +335 € ›  │
└─────────────────────────────────────────────────────────────┘
```

Jede Zeile:
- **Klickbar** → öffnet `ChatterSlideOver` (existiert schon)
- **Rechts**: konkreter Recovery-€-Betrag, premium typografisch (hell, tabular-nums)
- **Mitte**: Mini-Vergleich Baseline vs. aktuell (visuell wie bei Wechsel-Chip)
- **Hover**: zeigt 7-Tage-Sparkline der Revenue

Header zeigt **Summe aller Recovery-Beträge** — das ist der "Tagesziel-Anker", den der User vor Augen hat.

### Was der User damit konkret tut
1. Öffnet morgens das Dashboard.
2. Sieht oben: "Heute erreichbar: +1.840 €".
3. Klickt auf Lena_M → SlideOver mit Coaching-Notes, Inputs, History.
4. Coacht/handelt gezielt → Umsatz steigt → Eintrag verschwindet morgen aus der Liste.

Der Loop ist messbar: je weniger Einträge / je geringer die Tagessumme, desto besser läuft der Laden.

### Technische Umsetzung

**Neue Datei**: `src/lib/recovery-queue.ts`
- Funktion `computeRecoveryQueue(platform, history)` → liefert sortierte Recovery-Einträge.
- Lädt 30 Tage `chatter_history` (Pagination wie in `timerange-categorize.ts` schon vorhanden).
- Nutzt Median statt Mean für robustere Baseline (resistent gegen Ausreißer).

**Neue Komponente**: `src/components/RecoveryQueueCard.tsx`
- Glass-Morphism Karte im Stil von SwipeCard's Hero-KPI (konsistent mit existierendem Premium-Look).
- Top-Header mit Tagessumme in großer, leichter Schrift.
- Liste mit klickbaren Zeilen → öffnet `ChatterSlideOver`.
- Empty State ("Alle Chatter on track 🎯" — ohne Emoji, mit dezentem Icon).

**Integration in Dashboard.tsx**:
- Eingefügt zwischen Search (Zeile 254) und ForecastBanner (Zeile 257).
- Bekommt `platform` + `onChatterSelect={setSelectedChatter}`.
- Lädt eigene History via Supabase, unabhängig vom aktuell gewählten Report.

**Kein neues DB-Schema nötig** — alles aus `chatter_history` ableitbar.

### Was es bewusst NICHT ist
- Keine Gamification, keine Punkte, keine Streaks.
- Keine Vorhersage / kein ML — nur sauberer Vergleich Baseline vs. aktuell.
- Keine zusätzlichen Alerts — ersetzt nichts, ergänzt mit dem fehlenden Stück: **dem Euro-Hebel**.

