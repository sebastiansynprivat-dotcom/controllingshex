## Ziel

Live-Tracking auf „Geld-Hebel-Dashboard" umstellen: jede Karte zeigt sofort Lost Revenue, Trend und konkrete Action. Hero zeigt drei Money-Insights statt nur Aktiv-Quote. Smart-Sort priorisiert nach echtem Umsatz-Risiko.

---

## 1. Score & Lost-Revenue in `src/lib/live-activity.ts`

Erweitere `ChatterStatus` um:
- `lostRevenue: number` — abs. Wert des negativen Pacing-Deltas (0 wenn vorne dran)
- `priorityScore: number` — 0-100, gewichtet aus Lost €, Avg/Tag, Unread, ältestem Chat, Stunden-seit-Aktivität
- `actionText: string` — kurzer Imperativ („Anstoßen — 87 € Rückstand", „Chats abarbeiten · 12 offen", „Top Performer", etc.)

Score-Formel (gekappt 0-100):
```
score =
   max(0, -delta) × 1.0
 + avgRev          × 0.3
 + unread          × 1.5
 + oldestDays      × 5.0
 + (active ? hoursSinceLastSeen × 2 : 0)
```
Action wird abgeleitet aus dominantem Faktor (Lost €, viele Unread, alter Chat, Inaktiv).

## 2. Karten-Layout neu (`src/pages/LiveTracking.tsx` → `Row`)

Pro Karte sichtbar (von oben nach unten):
- **Header**: Avatar mit Status-Dot · Name · Sparkline (14d) · "8min" relTime
- **Action-Zeile**: prominent, farbcodiert nach Tone — z. B. „Anstoßen — 87 € Rückstand"
- **Heute-Vergleich**: `142 € heute · Ø 230 €/Tag` als feine Zeile
- **Pacing-Bar mit „Soll-Marker"**: vertikaler Strich an erwarteter Position
- **Chip-Reihe**: Ungelesen, Ältester offener Chat (nur wenn ≥1d), Mass-DMs

Lost-Revenue ist die optisch größte Zahl in der Action-Zeile (rot/amber je nach Höhe).

Neue Sub-Komponente `<Sparkline points={number[]} />` (inline SVG, 60×16, Stroke aus Status-Tone).

Sparkline-Daten: aus den bereits geladenen `profiles` ableiten. Erweiterung von `buildProfile`: zusätzlich `recentRevenues: number[]` (letzte 14 Tage, chronologisch).

## 3. Hero: 3 Money-Insights

Bisherige Aktiv-Quote bleibt als kleine Sekundär-Info. Stattdessen prominent:
- **Lost heute** (Σ aller `lostRevenue`) — große Zahl, gold/rot
- **Kritisch** (Anzahl mit `lostRevenue > 100 €`) — klickbar → setzt Filter
- **Top heute** (Chatter mit höchstem positiven Pacing-Delta + dessen +€)

Layout: 3-Spalten-Grid statt vertikalem KPI-Block. Heatmap-Streifen bleibt unter den Stats.

## 4. Smart-Sort nutzt `priorityScore`

In `src/pages/LiveTracking.tsx`:
- `allStatuses.sort` Bucket-Reihenfolge bleibt (weak → idle → inactive → strong), aber innerhalb jedes Buckets nach `priorityScore` desc statt nach Revenue.
- Sort-Tab „Smart" sortiert flach nach `priorityScore` desc, zeigt also wirklich „wo verliere ich gerade am meisten Geld" zuerst.
- Bestehende Sort-Tabs (Prio Ø/Tag, Umsatz, Pacing-Δ, Aktivität) bleiben unverändert als Alternativen.

---

## Bewusst nicht im Scope

- Keine neuen DB-Tabellen oder Edge-Functions, alles aus vorhandenen Daten (`chatter_history_live` + `chatter_history`).
- Keine Push-Notifications oder Realtime-Sound-Alerts.
- Sparkline rein clientseitig (SVG, keine Chart-Lib).

## Aufwand

Eine erweiterte Lib-Datei (~40 neue Zeilen) und eine größere UI-Refactor in `LiveTracking.tsx` (~120 geänderte Zeilen). Keine Migration nötig.
