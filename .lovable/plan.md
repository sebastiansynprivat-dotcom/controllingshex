## Was wir machen

Fünf gezielte Änderungen am Heute-Tab — keine neue Engine, keine neuen Tabellen.

### 1. Wins abhakbar machen

Aktuell sind Wins nur ein Status-Filter zum Ansehen. Künftig:
- Wins-Karten kriegen denselben Action-Footer wie Primary-Karten (Erledigt / 4h später / Heute ausblenden).
- Erledigte Wins wandern in „Erledigt" — Logik identisch zu bestehenden Todos (`daily_todo_state` mit dem Wins-Key).
- Datei: `src/pages/Today.tsx` — Readonly-Flag entfernen, wenn `status === "wins"`.

### 2. Auffälligkeiten 14T + 30T als Standardansicht im Heute-Tab

Statt „heute vs. 14T-Median"-Spam ziehen wir die Auffälligkeiten-Logik direkt rein, **kombiniert 14T + 30T** als feste Default-Sicht (kein Filter-UI).

Eine Auffälligkeit erscheint nur, wenn sie **in beiden Fenstern** (14T und 30T) bestätigt ist:
- Revenue, Mass-DMs, offene Chats: 14T-Schnitt unter 30T-Schnitt × Schwelle UND aktueller Tag bestätigt das.
- Ein einzelner schwacher Tag bei stabiler 30T-Historie → kein Eintrag mehr.

Karten kriegen klares Wording: „Sarah · letzte 14T: 38 €/Tag vs. 30T: 72 €/Tag (−47 %). Heute: 22 €." Damit ist sofort sichtbar, **was** in dem Zeitraum schiefging.

Dateien: `src/lib/daily-todos.ts` (Trigger-Block für `revenue`/`activity`), neuer Helper `src/lib/chatter-windows.ts` mit 14/30T-Aggregaten.

### 3. Onboarding-Regel fixen

In `daily-todos.ts` `isOnboarding`-Check anpassen:
- Tag 1 → komplett raus (nichts zählt).
- Tag 2–5 → nur **Verzug** zählt, alles andere ignoriert.
- Ab Tag 6 → alles wie normal.

Bisher: Tag 1–5 komplett geschützt. Neu: ab Tag 2 zählt Verzug.

### 4. Talent + Account-Mismatch neu ranken

**Talent-Score** (Reihenfolge der Voraussetzungen, jede Stufe = höherer Rang):
1. Grundvoraussetzung: Chatter arbeitet **aktiv Chats ab** (offene Chats nicht aufgestaut) **und** schickt **Mass-DMs** in den letzten 3–6 Tagen. Erst dann erscheint er als Talent.
2. Bonus-Stufe: zusätzlich **Revenue** in dem Zeitraum → höher gerankt und visuell stärker hervorgehoben (z.B. Stern/Glow).

Score-Formel: `Aktivitäts-Punkte (Chats abgearbeitet 0–1) × DM-Konstanz (0–1) × (1 + Revenue-Boost 0–1.5)`.

**Account-Mismatch-Score** (Account schlecht besetzt):
- Eingang: Account-Größe (Follower) × historische Account-Performance (30T-Schnitt-Umsatz auf diesem Account).
- Trigger: aktueller Chatter performt unter dem 30T-Schnitt des Accounts (z.B. < 70 %) **oder** hat langen Verzug auf einem großen Account.
- Ranking: `(Follower-Tier × hist. Account-Revenue) × Underperformance-Gap`.

Dateien: `src/lib/talent-scout.ts` (Talent-Gate + Stufen), `src/lib/today-engine.ts` (Mismatch-Score), gemeinsame Datenquelle für Account-Historie.

### 5. Drag-and-Drop-Board „Talente ↔ Underperformer-Accounts"

Eine neue eigene Sektion im Heute-Tab, unter dem normalen Aktionsstream:

```text
┌──── Talente (links) ──────────┐  ┌──── Account ungenutzt (rechts) ──┐
│ ⭐ Sarah · 6T aktiv +Revenue │  │ luna_x · 12k Follower, −58 % vs 30T │
│ Lina · 5T Chats+DMs          │  │ Mia · 4T Verzug, großer Account     │
│ Jana · 4T Chats+DMs          │  │ k.rose · Underuser performt −40 %   │
└──────────────────────────────┘  └─────────────────────────────────────┘
```

- Karten frei per Drag-and-Drop **innerhalb** der jeweiligen Spalte verschieb- und sortierbar (manuelle Reihenfolge überschreibt Auto-Rang).
- Reihenfolge wird pro User/Platform in `settings` als JSON-Array `talent_board_order` und `mismatch_board_order` persistiert.
- Initial-Reihenfolge = automatischer Rang aus Schritt 4. Reset-Button stellt Auto-Rang wieder her.

Library: `@dnd-kit/core` + `@dnd-kit/sortable` (leichtgewichtig, A11y-ready).
Datei: neues Component `src/components/today/MatchBoard.tsx`, eingebunden in `Today.tsx` unterhalb der Action-Liste.

## Technische Details

- Keine Schema-Änderungen. Sortier-Reihenfolge nutzt die existierende `settings`-Tabelle (`key = 'talent_board_order:<platform>'`).
- Neuer Helper `src/lib/chatter-windows.ts` (~80 LOC) liefert `{ rev14, rev30, dm14, dm30, chats14, chats30 }` pro Chatter, wird von Today + Auffälligkeiten gemeinsam genutzt.
- `@dnd-kit/core` + `@dnd-kit/sortable` als neue Dependencies.
- Wins-Aktionen: bestehende `act()`-Funktion akzeptiert wins, nur das `isReadonly`-Flag wird angepasst.

## Was sich für dich ändert

- Wins abhakbar wie normale Todos.
- Heute-Tab zeigt nur noch echte Auffälligkeiten, die sowohl in 14T als auch in 30T sichtbar sind — kein „1 statt 5 DMs"-Lärm mehr.
- Onboarding-Tag-1 raus, ab Tag 2 Verzug zählt.
- Talente nur, wenn Chats abgearbeitet + DMs gehen. Revenue = extra Highlight.
- Großer Account schlecht besetzt → wird verlässlich angezeigt.
- Neue Sektion: Talente links, schlecht besetzte Accounts rechts, Karten frei per Drag-and-Drop sortierbar.
