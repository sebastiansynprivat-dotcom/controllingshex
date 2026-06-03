## Ziel

Die "Account liegt brach"-Karten sollen sofort den Kontext liefern, der für die Entscheidung "lohnt sich der Wechsel?" nötig ist — Account-Name (schon da), Größe, langfristiger Umsatz-Schnitt und was zuletzt rauskam.

## Was angezeigt wird

Beispiel neue Beschreibung (statt aktuell `S-Account bei Janette Hornjak: ältester Chat 12T offen · 68 ungelesen. Wechsel prüfen.`):

> S-Account `Lia Rose` (12.4k Follower) bei Janette Hornjak · Ø 6T: 142 € · zuletzt (2T): 38 € · ältester Chat 12T offen · 68 ungelesen. Wechsel auf verlässlicheren Chatter prüfen.

Felder:
- **Account-Name** (schon vorhanden, bleibt im Titel)
- **Follower** (formatiert: `12.4k`, `1.2M`)
- **Ø 6T**: Durchschnitt € pro aktivem Tag der letzten 6 Tage (ohne heute) — vorhandenes `avgRevenue`
- **Zuletzt (2T)**: Ø € der letzten 2 abgeschlossenen Tage — zeigt Trend gegenüber 6T-Schnitt
- bestehende Live-Signale (ältester Chat, ungelesen) bleiben

## Technische Umsetzung

`src/lib/talent-scout.ts`:
- `ChatterAgg` und `OrphanWarning` um `followers`, `avgRevenue6d`, `recentAvgRevenue2d` erweitern (followers ist intern schon vorhanden, nur durchreichen).
- In `loadAggs` zusätzlich `recentAvgRevenue2d` aus den 2 jüngsten Rows (≠ today) berechnen — Mittelwert über die Tage mit Umsatz > 0, sonst 0.
- `findOrphanedAccounts` reicht die Felder durch.

`src/lib/daily-todos.ts` (Orphan-Block ~Z. 508-524):
- Helper `fmtFollowers(n)` (k/M-Format) und `fmtEur(n)` für saubere Anzeige.
- `why`-String neu zusammensetzen mit Account-Name, Follower, Ø 6T, Zuletzt 2T und den bestehenden Live-Reasons.

Match-Karten (Workhorse ↔ Underuser) werden in diesem Schritt **nicht** angefasst — nur die Solo-Orphan-Warnung, wie vom User adressiert.

## Nicht enthalten

- Keine UI/Komponenten-Änderungen, nur Signal-Text.
- Keine neuen Tabellen oder Queries — nutzt vorhandene `chatter_history` + `models`.
