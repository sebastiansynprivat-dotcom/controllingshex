## Ziel
In der Verzug-Model-Übersicht (unter jeder Chatterkarte im Heute-Tab → Verzug) sollen pro Account direkt die Login-Daten (E-Mail + Passwort) mit angezeigt werden — analog zum Tinder-Mode, wo das schon existiert.

## Umsetzung

**1. `src/pages/Today.tsx` — Login-Map laden**
- Neuen State `accountLogins: Map<string, { email?: string|null; password?: string|null }>` (Key = `account.toLowerCase()`).
- Im bestehenden `useEffect` für `verzugBreakdown` (Zeile ~366–545) zusätzlich `models` abfragen: `select("model_name,email,password")` gefiltert auf `platform` + `user_id`.
- Map bauen und via State setzen.

**2. `src/components/PersonActionCard.tsx` — Anzeige**
- Neue optionale Prop `accountLogins?: Map<string, { email?: string|null; password?: string|null }>`.
- Im Verzug-Breakdown-Block (Zeile 703–753) unter jeder Model-Zeile eine dezente zweite Zeile ergänzen, wenn Login vorhanden:
  - `Mail`-Icon + E-Mail (truncate) mit Copy-Button
  - `Key`-Icon + Passwort maskiert (`••••••••`) mit Toggle „anzeigen" + Copy-Button
  - Klick auf Copy → `navigator.clipboard.writeText` + kurzer Toast („Kopiert").
- Klick auf Login-Zeile stoppt Propagation, damit nicht das Model-Details-Overlay aufgeht.
- Wenn kein Login für den Account existiert: kleiner grauer Hinweis `keine Login-Daten hinterlegt` (klickbar → öffnet `/models` mit dem Account? Optional, sonst nur Text).

**3. Prop-Durchreichung**
- In `Today.tsx` an allen 3 Stellen (Zeile 1305, 1340, 1366) `accountLogins={accountLogins}` mitgeben.

## Technisches
- Wiederverwendetes Icon-Set aus lucide (`Mail`, `Key`, `Copy`, `Eye`, `EyeOff`) — bereits verfügbar.
- Passwort im DOM nur laden, wenn tatsächlich gesetzt; per Default maskiert.
- Keine Logik-Änderung an `today-engine`, `buildTodayActions`, DB oder Edge Functions.
- Nur Frontend + eine zusätzliche `models`-Query im bestehenden `useEffect`.

## Nicht im Scope
- Keine Änderung an Tinder-Mode oder anderen Ansichten.
- Kein neues Feld in DB — `models.email/password` sind bereits vorhanden.