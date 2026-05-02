## Neuer Tab: Monatsziele

Neuer Sidebar-Eintrag + Seite, die alle Chatter mit dem Label **"Monatsziel"** auflistet, das Ziel aus den Notizen extrahiert und Fortschritt vs. Soll anzeigt.

### Datenfluss

1. Lade `chatter_labels` → finde ID des Labels `Monatsziel` (`12ea8447-…`).
2. Lade alle `chatter_label_assignments` mit dieser `label_id` → Liste der Chatter-Namen.
3. Für jeden Chatter:
   - Lade `coaching_notes` (neueste zuerst), extrahiere die erste Note, in der eine Zahl steht. Regex: `/-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d+)?|\d+/` — danach Tausender-Trenner (`.`/Space) entfernen, Komma → Punkt, parseFloat. Beispiel: `"2.000"` → `2000`.
   - Lade `chatter_history` für den **aktuellen Monat** (vom 1. bis heute), summiere `revenue_today` → `currentRevenue`.
4. Berechne pro Chatter:
   - `daysInMonth`, `daysPassed`, `daysRemaining`
   - `dailyTarget = goal / daysInMonth`
   - `requiredPerRemainingDay = (goal − currentRevenue) / daysRemaining`
   - `expectedSoFar = dailyTarget * daysPassed`
   - `progressPct = currentRevenue / goal * 100`
   - **On Track**: `currentRevenue >= expectedSoFar * 0.95` (grün), `>= 0.8` (amber), sonst rot.

### UI

- Header mit Monats-Name + Anzahl Chatter mit Ziel.
- Sortierung: Default „Am weitesten hinten" (größtes Defizit zuerst). Toggle: Name / Fortschritt / Ziel.
- Karten-Grid (responsive: 1 / 2 / 3 Spalten):
  - Chatter-Name + Status-Badge (On Track / Knapp / Off Track)
  - Großer Progress-Bar (% des Ziels)
  - Stats-Trio:
    - **Ziel**: 2.000 €
    - **Aktuell**: 1.234 € (X% erreicht)
    - **Soll heute**: Y € (Differenz farbig)
  - Footer-Zeile: „Ø nötig/Tag bis Monatsende: Z €" + „Tage übrig: N"
- Klick auf Karte öffnet existierendes `ChatterSlideOver`.
- Leerer Zustand: Hinweis, wie man das Label vergibt + Zahl in Notiz schreibt.

### Technische Details

- **Neue Datei**: `src/pages/MonthlyGoals.tsx`
- **Helper** (inline oder neue `src/lib/monthly-goals.ts`):
  - `parseGoalFromNote(text: string): number | null`
  - `computeGoalProgress(goal, revenueSoFar, today): { dailyTarget, requiredPerRemainingDay, expectedSoFar, progressPct, status }`
- **Sidebar** (`src/components/AppSidebar.tsx`): neuer Eintrag „Monatsziele" mit `Target`-Icon (lucide), Position direkt nach „Auffälligkeiten".
- **Route** (`src/App.tsx`): `/monatsziele` → `MonthlyGoals`.
- Plattform-aware via `usePlatform()`, Reload bei Plattform-Wechsel.
- Filter `platform=eq.{platform}` und `user_id=auth.uid()` (RLS regelt das).

### Edge Cases

- Notiz ohne Zahl → Chatter wird übersprungen (mit Hinweis im leeren Zustand).
- Mehrere Zahlen in einer Notiz → erste Zahl im Text wird genommen (neueste Notiz hat Priorität).
- Ziel = 0 → ausblenden.
- Letzter Tag des Monats → `daysRemaining = max(1, …)` zur Vermeidung Division durch 0.
