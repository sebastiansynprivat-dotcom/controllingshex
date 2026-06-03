## Ziel

Die Talent-Match-Karten (Workhorse ↔ Underuser) sollen am Underuser-Account dieselben Kontext-Infos zeigen wie die Solo-Brach-Karten: Account-Name (schon da), Follower, Ø 6T-Umsatz, Ø letzte 2T.

## Beispiel

Statt:
> ...Account Lia Rose (S) bei Janette Hornjak live: ältester Chat 12T offen · 68 ungelesen.

Neu:
> ...Account Lia Rose (S, 12.4k Follower) bei Janette Hornjak · Ø 6T: 142 € · zuletzt (2T): 38 € · ältester Chat 12T offen · 68 ungelesen.

## Umsetzung

`src/lib/talent-scout.ts` — `TalentMatch` Interface erweitern:
- `underuserFollowers: number`
- `underuserAvgRevenue6d: number`
- `underuserRecentAvgRevenue2d: number`

In `findTalentMatches` aus `candidate.a` durchreichen (Felder existieren bereits in `ChatterAgg`).

`src/lib/daily-todos.ts` — Talent-Match-Block (~Z. 482-504):
- Helper `fmtFollowers` / `fmtEur` aus dem Orphan-Block in den Funktions-Scope ziehen (oben definieren), damit beide Blöcke ihn nutzen.
- `why`-String für den Underuser-Teil neu zusammenbauen mit Follower + Ø 6T + zuletzt 2T + Live-Bits.

Riser-Teil bleibt unverändert.

## Nicht enthalten

- Keine UI-Änderungen, nur Signal-Text.
