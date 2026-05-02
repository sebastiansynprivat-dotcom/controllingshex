# Monatsziele: Tabs + Vorschlag-Flow

## Ziel
Auf der Seite `/monatsziele` zwei Tabs einbauen:
1. **Aktuelle Monatsziele** — die bisherige Ansicht (Chatter mit Label "Monatsziel" + Notiz-Zahl).
2. **Zukünftige Monatsziele** — alle anderen aktiven Chatter, mit automatisch berechnetem Vorschlag und einem "Annehmen"-Flow.

Status-Filter (On Track / Knapp / Off Track) bleibt nur im Tab "Aktuelle".

## Tab "Zukünftige Monatsziele"

### Welche Chatter werden gelistet
- Alle Chatter aus `chatter_history` der letzten 30 Tage, die **noch kein** Label "Monatsziel" haben.
- Nur "aktive" Chatter: **Ø Tagesumsatz > 1 €** über die letzten 30 Tage (Reports berücksichtigen 1-Tag-Lag wie bisher).

### Berechneter Vorschlag
Formel: `Ø Tagesumsatz (letzte 30 Tage) × Tage im aktuellen Monat × 1.10`  
Auf 50 € gerundet (sieht hübscher aus, z. B. „3.450 €" statt „3.428,17 €").

Karte zeigt:
- Chatter-Name
- Ø Tagesumsatz (30 d)
- Aktueller Monatsumsatz bisher
- **Vorgeschlagenes Monatsziel** (groß, prominent)
- Button **"Annehmen"** → öffnet Mini-Edit
- Button **"Überspringen"** (nur lokal, blendet Karte für Session aus)

### Annehmen-Flow (Edit-vor-Annehmen)
1. Klick auf "Annehmen" → Inline-Edit mit dem Vorschlag als Default.
2. User kann Zahl anpassen.
3. Bestätigen → in einer Aktion:
   - Label "Monatsziel" zuweisen (`chatter_label_assignments`)
   - Notiz anlegen in `coaching_notes`: `"Monatsziel <Monat Jahr>: <Betrag> €"`
4. Toast "Monatsziel für <Chatter> gesetzt".
5. Chatter verschwindet aus "Zukünftige" und taucht im Tab "Aktuelle" auf (Refresh nach Insert).

## Tab "Aktuelle Monatsziele"
Unverändert: Karten, Status-Filter, Sort, Klick = Name kopieren / Doppelklick = Profil.

## Technische Details

### Datenladen
Eine zusätzliche Query parallel zum bestehenden Load:
```sql
-- Ø der letzten 30 Tage pro Chatter
SELECT chatter_name, AVG(revenue_today) AS avg30, SUM(revenue_today) AS sum30
FROM chatter_history
WHERE platform = $1
  AND analysis_date >= today - 30 days
  AND analysis_date <= today
GROUP BY chatter_name
HAVING AVG(revenue_today) > 1;
```
Im Code als `.gte/.lte` + clientseitiges Group-by (wie bestehende Patterns).

### Vorschlag-Logik (`src/lib/monthly-goals.ts`)
Neue Helper-Funktion:
```ts
export function suggestMonthlyGoal(avgDailyRevenue: number, today = new Date()): number {
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const raw = avgDailyRevenue * daysInMonth * 1.10;
  return Math.round(raw / 50) * 50; // auf 50 € runden
}
```

### Annehmen-Aktion
- `chatter_label_assignments` insert (label_id = bestehendes Monatsziel-Label, ggf. on-the-fly anlegen falls noch nicht existiert für die Plattform).
- `coaching_notes` insert mit `note_text = "Monatsziel <Monat Jahr>: <formatEUR(Ziel)>"`.
- Beide Inserts mit `user_id = session.user.id`.

### UI
- Neuer Tab-Switcher direkt unter dem Hero (wie bestehende Filter-Pill-Style).
- Status-Filter und Sort-Bar nur im Tab "Aktuelle" rendern.
- Vorschlag-Karte = neue Komponente `SuggestionCard` im selben Stil wie `GoalCard` (dunkles Glas, abgerundet), aber mit grün-getöntem Vorschlagswert + Action-Buttons.

## Files
- `src/pages/MonthlyGoals.tsx` — Tabs + zweite Liste + Annehmen-Logik
- `src/lib/monthly-goals.ts` — `suggestMonthlyGoal()` Helper
