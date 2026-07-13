
# Model Scout — Models mit Potenzial erkennen

## Idee in einem Satz
Eine neue Seite `/content-scout`, die pro Model einen **Content-Score** zeigt (aus historischen Einzelverkäufen + Chat-Pull) und Models markiert, deren Content-Potenzial im Verhältnis zu ihrer Sichtbarkeit unterschätzt wird.

## Datenlage (was wir schon haben)
- `chatter_history` — pro Chatter+Account+Tag: `revenue_today`, `mass_dms`, `open_chats`. Aggregierbar über Account = Model.
- `chatter_history_live.revenue_details` (JSONB) — enthält jeden Einzelverkauf pro Model heute (Zeit, Betrag, Customer, purchase_id). Wird pro Tag gespeichert (Zeile pro `date`).
- `models` — Follower-Count pro Model.
- `chatter_incoming_stats` — eingehende Nachrichten pro Chatter/Tag.

Das reicht für beide gewünschten Signale (Einzelverkäufe historisch + Chat-Volumen) ohne neue Datenquellen.

## Score-Formel (pro Model, Zeitraum wählbar)
Alles auf **Ø pro Tag** normalisiert, damit unterschiedlich lange Zeiträume vergleichbar sind. Pro Signal 0..1 gemappt (Perzentil-Skalierung innerhalb der Plattform), dann gewichtet:

```text
ContentScore =
    40% × SalesSignal        (Ø Einzelverkäufe / Tag aus revenue_details)
  + 25% × RevenueSignal      (Ø € / Tag aus chatter_history.revenue_today)
  + 25% × ChatPullSignal     (Ø offene/eingehende Chats / Tag)
  + 10% × ConsistencySignal  (Anteil Tage mit ≥1 Verkauf im Zeitraum)
```

Zusätzlich: **Hidden-Gem-Flag** wenn `ContentScore` im Top-Quartil ist, aber:
- Follower im unteren Drittel der Plattform, ODER
- Model taucht nirgends im Heute-Tab als "Priority" auf.

## UI: neue Seite `/content-scout`
- Header mit `TimeRangeToggle` (Heute / 7T / 14T / 30T / Custom) und Plattform-Filter (nutzt bestehenden `PlatformContext`).
- Zwei Sektionen untereinander:
  1. **Hidden Gems** — Karten-Grid, nur Models mit Gem-Flag. Badge "Unterschätzt". Sortiert nach Score.
  2. **Alle Models — Ranking** — Tabelle/Listen-Layout, sortierbar. Spalten: Model, Follower + Tier, Ø Sales/Tag, Ø €/Tag, Ø Chats/Tag, Konsistenz %, Score-Balken, Trend-Pfeil vs. Vorperiode.
- Klick auf ein Model öffnet den bestehenden `ModelPerformanceSlideOver`.
- Navigation: Eintrag in `AppSidebar` mit passendem Icon (z.B. `Sparkles`).

## Technische Umsetzung
1. **Neue Lib** `src/lib/content-scout.ts`
   - `loadModelContentScores(platform, from, to)` → parallel `fetchAllPaged` auf:
     - `chatter_history_live` (Zeitraum) — Einzelverkäufe aus `revenue_details` extrahieren, pro `account` aggregieren.
     - `chatter_history` (Zeitraum) — `revenue_today`, `open_chats` pro `account` summieren.
     - `models` (Plattform) — Follower.
   - Normalisierung + Perzentil-Ranking + Gem-Flag.
2. **Neue Page** `src/pages/ContentScout.tsx` — Header + zwei Sektionen wie oben.
3. **Neue Komponenten**
   - `src/components/content-scout/HiddenGemCard.tsx`
   - `src/components/content-scout/ModelScoreRow.tsx`
4. **Routing** in `src/App.tsx` + Sidebar-Link in `src/components/AppSidebar.tsx`.
5. **Kein neues Schema, keine Migration.** `revenue_details` liegt bereits pro Tag/Model vor.

## Verifizierung
- Manuelle Prüfung: Ranking gegen bekannte Top-Umsatz-Models plausibilisieren.
- Playwright-Screenshot der neuen Seite auf Mobil-Viewport.
- TypeScript-Check.

## Explizit NICHT drin
- Keine Änderungen am Heute-Tab oder anderen bestehenden Seiten.
- Keine neuen DB-Tabellen (Einzelverkäufe kommen live aus `revenue_details`, retrospektiv aus den bereits vorhandenen Tages-Zeilen).
- Keine Änderung an Score-Gewichten für andere Features.
