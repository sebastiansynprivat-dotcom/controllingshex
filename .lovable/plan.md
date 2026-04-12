

## Kategorie-Überarbeitung: Alle 5 Vorschläge umsetzen

### Änderungen im Prompt (`supabase/functions/analyze-csv-batch/index.ts`)

**A) Mittelfeld aufteilen** — SCHRITT 8 (Fallback) wird ersetzt:

```text
SCHRITT 8 — MITTELFELD segmentieren (Fallback):
→ ⭐ TOP PERFORMER — Tagesumsatz heute > Ø aller Chatter im Batch. Starke Leistung!
→ ⚪ WEITER SO — Tagesumsatz > 0€, aber ≤ Batch-Durchschnitt. Solide, aber Luft nach oben.
→ 👀 UNTER BEOBACHTUNG — Tagesumsatz = 0€ heute, aber kein 0€-Streak (nur 1 Tag). Noch kein Alarm.
```

**B) Comeback-Kategorie** — Neuer SCHRITT 5b (nach 0€-Streak, vor positive Kategorien):

```text
SCHRITT 5b — COMEBACK prüfen:
→ 🔄 COMEBACK — Chatter hatte laut Historie 3+ Tage in Folge 0€, hat aber HEUTE wieder Umsatz > 0€.
  → Empfehlung: "Comeback nach X Tagen Pause. Positiv bestärken und eng begleiten."
```

**C) Traffic Test umwidmen** — In SCHRITT 6 wird `ACCOUNT UPGRADE (TRAFFIC TEST)` ersetzt:

```text
→ 📊 HOHER TRAFFIC / KEINE CONVERSION — > 3 MassDMs heute, aber 0€ Umsatz.
  → Empfehlung: Coaching zur Conversion-Optimierung statt Account-Upgrade.
```

**D) Breakout-Schwelle senken** — In SCHRITT 6:

```text
→ 🌟 BREAKOUT-STAR — Tagesumsatz ist mindestens 2x höher als der historische Durchschnitt (braucht Historie!).
```
(Von 3x auf 2x gesenkt)

**E) Coaching klarer abgrenzen** — SCHRITT 7 wird präziser:

```text
SCHRITT 7 — COACHING prüfen:
→ 📼 VIDEO-COACHING — Seit >= 7 Tagen aktiv UND in den letzten 7 Tagen insgesamt < 20€. 
  Langzeit-Underperformer, braucht Video-Schulung.
→ 🟡 COACHING / ENGERE KONTROLLE — Seit 5-6 Tagen aktiv UND in den letzten 5 Tagen insgesamt < 15€. 
  Noch früh genug für engere Begleitung.
```

### Datei die geändert wird

1. **`supabase/functions/analyze-csv-batch/index.ts`** — Nur der `formatInstructions`-String wird aktualisiert (Schritte 5b, 6, 7, 8). Keine Code-Logik-Änderung nötig, alles wird über den Prompt gesteuert.

### Zusammenfassung der neuen Kategorie-Hierarchie

```text
1. ONBOARDING TAG 1-5        (unverändert)
2. WARNUNG                    (unverändert)
3. ACCOUNT-EINBRUCH           (unverändert)
4. MODEL-TAUSCH               (unverändert)
4b. ACCOUNT UPGRADE (ZUVERLÄSSIG) (unverändert)
5. 0€ UMSATZ TAG 1-7+        (unverändert)
5b. COMEBACK                  (NEU — nach 3+ Tagen 0€ wieder aktiv)
6. BREAKOUT-STAR              (Schwelle 3x → 2x)
   ACCOUNT UPGRADE (UMSATZ-STREAK) (unverändert)
   KURZ VOR UPGRADE           (unverändert)
   HOHER TRAFFIC / KEINE CONVERSION (umgewidmet von Traffic Test)
7. VIDEO-COACHING             (≥7 Tage, <20€ in 7 Tagen)
   COACHING / ENGERE KONTROLLE (5-6 Tage, <15€ in 5 Tagen)
8. TOP PERFORMER              (NEU — über Ø)
   WEITER SO                  (Umsatz > 0€, unter Ø)
   UNTER BEOBACHTUNG          (NEU — heute 0€, aber kein Streak)
```

