

## Plan: Kategorisierung fixen — 0€-Umsatz und bessere Regeln

### Das Problem
Die `step2_categorize`-Funktion hat aktuell nur 4 Regeln, und keine davon fängt den Fall ab, dass ein Chatter **0€ Tagesumsatz** hat. Solche Chatters landen pauschal in "WEITER SO / MITTELFELD", was irreführend ist.

### Die Lösung: Neue Kategorie + überarbeitete Prioritäten

Die Kategorisierung in `src/lib/analysis-pipeline.ts` wird um eine **"NULL EURO TAG"**-Kategorie erweitert und die Reihenfolge wird angepasst:

| Priorität | Regel | Kategorie | Emoji |
|---|---|---|---|
| 1 | Oldest Chat > 3 Tage | WARNUNG | 🟠 |
| 2 | Onboarding ≤ 5 Tage | ONBOARDING TAG X | 🔵 |
| **3 (NEU)** | **Tagesumsatz = 0€** | **NULL EURO TAG** | **🔴** |
| 4 | All-Time > 500€ & Oldest Chat ≤ 2 | ACCOUNT UPGRADE | 🟢 |
| 5 | Rest | WEITER SO / MITTELFELD | ⚪ |

So wird jeder Chatter mit 0€ Tagesumsatz (der kein Newcomer ist und keine Chat-Warnung hat) sofort rot markiert und separat angezeigt.

### Dateien

| Datei | Änderung |
|---|---|
| `src/lib/analysis-pipeline.ts` | Neue Regel in `step2_categorize` zwischen Onboarding und Top-Performer einfügen |

Nur eine Datei, eine Änderung — alles andere (Karten, Dashboard, Swipe) nutzt bereits die Kategorie-Daten und zeigt die neue Kategorie automatisch an.

