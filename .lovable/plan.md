# Live-Tab — Handling & Filter Upgrade

Ziel: Karten & Layout bleiben unangetastet. Nur das **Drumherum** (Filter, Sort, Suche, Insight-Chips, Debug-Log) wird kompakter, klarer und smarter.

## Probleme heute

1. **Zwei getrennte Steuer-Zeilen** (Filter-Chips + Sort-Chips) konkurrieren visuell, nehmen viel Höhe — auf 440px Mobile besonders störend.
2. **Sort hat 5 Optionen** mit kryptischen Labels ("Prio (Ø/Tag)", "Pacing-Δ") — wirkt technisch, nicht produktiv.
3. **Bucket-Ansicht** (Unter Pacing / Pause / Inaktiv / Läuft sauber) verschwindet, sobald irgendein Filter oder Sort gesetzt wird → man verliert die Übersicht.
4. **Insight-Chips** ("Unter Pacing X · Heute noch nicht aktiv Y") dupliziert exakt die Filter-Chips drunter.
5. **Suche hinter Icon** im Hero-Header — schwer zu finden, klein.
6. **Debug-Log** ("Live-Log · X Events") ist prominent vor den Karten, obwohl es Diagnostik ist.
7. **Sticky-Verhalten fehlt** — beim Scrollen verliert man Filter komplett aus dem Blick.

## Neue Struktur

```text
┌─ Hero (Live-Pulse Karte + Mini-Stats)              [bleibt]
├─ Toolbar  (sticky, eine Zeile)
│   [Alle 24] [Aktiv 18] [Pacing 3] [Inaktiv 6]   🔍 ⇅
├─ Buckets (immer sichtbar, auch bei Filter)
│   • Unter Pacing
│   • Pause
│   • Inaktiv
│   • Läuft sauber (collapsed)
└─ Debug-Log (zusammengeklappt, ganz unten)
```

### 1. Eine smarte Toolbar (sticky)

- **Segmented Filter** (Alle / Aktiv / Pacing / Inaktiv) mit Counts — bleibt, aber als echtes Segmented-Control mit aktivem Indikator-Pill statt einzelner Buttons.
- **Suche** als inline-Input rechts (immer sichtbar, schmal, expandiert beim Fokus). Kein Icon-Toggle mehr.
- **Sort als Dropdown-Menü** (kein Chip-Streifen). Default: "Smart". Reduzierte Optionen:
  - Smart (Prio-Score)
  - Höchster Verlust heute
  - Aktivität (zuletzt online)
  - Umsatz heute
  - Ø Tagesumsatz
- Toolbar wird `sticky top-0` mit Backdrop-Blur, damit man beim Scrollen Filter und Suche behält.

### 2. Insight-Chips entfernen

Dupliziert die Filter — ersatzlos streichen. Die Counts stehen bereits in den Filter-Pills und in den Bucket-Headern.

### 3. Buckets immer sichtbar

Aktuell nur bei `filter=all && sort=smart`. Neu:
- **Bucket-Layout ist Default** und bleibt **bei jedem Filter**.
- Filter blendet einfach die anderen Buckets aus (z.B. "Pacing" → nur Pacing-Bucket sichtbar).
- Sort wirkt **innerhalb** der Buckets.
- Suche filtert quer durch alle Buckets.

### 4. "Läuft sauber"-Bucket smarter

- Standardmäßig collapsed (wie heute), aber im Header zusätzlich Σ-Umsatz und größter Surplus zeigen ("12 Chatter · +840 € heute").
- Auto-expand wenn das einzige nicht-leere Bucket nach Filterung.

### 5. Debug-Log nach unten

- Aus dem Hero-Bereich entfernen.
- Kleines, unauffälliges "Live-Log"-Akkordeon **am Ende der Seite** (unter den Karten).
- Zähler bleibt sichtbar, Default collapsed.

### 6. Empty-States pro Bucket

Statt globalem "Keine Chatter passen zum Filter": pro leerem Bucket eine subtile Microcopy ("Niemand unter Pacing — gut so 👌🏻"), nur wenn aktiv gefiltert.

## Technische Umsetzung

Alle Änderungen in `src/pages/LiveTracking.tsx`:

- **Toolbar-Block** (Zeilen ~759-815) komplett neu: ein sticky `<div>` mit Segmented-Filter, Search-Input und Sort-`DropdownMenu` (`@/components/ui/dropdown-menu` ist vorhanden).
- **Insight-Chips Block** (Zeilen ~732-755) entfernen.
- **Search im Hero** (Zeilen ~561-578) entfernen, nur Live-Status-Indikator behalten.
- **Render-Logik** (Zeilen ~817-864): Bucket-Branch wird zum Default; der "flat list"-Branch entfällt. `buckets` aus `visible` nutzen, damit Filter+Sort+Suche darin wirken.
- **Sort-Optionen** in `SortKey` reduzieren/umbenennen:
  ```ts
  type SortKey = "smart" | "lost" | "activity" | "revenue" | "avg";
  ```
  und Sort-Reducer entsprechend anpassen (`lost` = `b.lostRevenue - a.lostRevenue`).
- **Debug-Log Block** (Zeilen ~679-729) ans Ende der Seite verschieben (vor `ChatterSlideOver`).
- Sticky: `sticky top-0 z-20 -mx-* px-* py-2 bg-background/80 backdrop-blur-xl border-b border-white/[0.05]`.

Keine Änderungen an: Hero-KPI-Karte, `Row`-Komponente, `Bucket`-Komponente, Datenlogik, Realtime-Subscriptions, Server-Live-Now-Logik, `live-activity.ts`.

## Out of Scope

- Karten-Design (Row) — User mag es so.
- KPI-Hero-Karte — User mag es so.
- Datenmodell / Edge Functions — funktionieren laut User.
