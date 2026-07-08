## Ziel
Das Chatter-Profil (`ChatterSlideOver`) aufräumen: weniger Rauschen, wichtige Zahlen sofort im Blick, Labels als schneller Header-Kontrol statt großer Sektion, keine ungenutzten Blöcke mehr. Keine Datenquelle wird gelöscht — nur UI/Anordnung.

## Neue Sektions-Reihenfolge (oben → unten)

1. **Hero-Header** — Avatar · Name · Platform · 30T-Trend-Pill · **Labels-Chip-Row + „+ Label"-Dropdown** · Vergleichen · Schließen
2. **Live-KPIs (Echtzeit)** — Tagesumsatz · Mass-DMs · „Heute aktiv"-Zeile (unverändert)
3. **Basis-KPIs (2×2)** — bestehende Kennzahlen (unverändert)
4. **30-Tage-Trend** _(hochgezogen)_
5. **Postfach-Disziplin** _(hochgezogen)_
6. **Models & Logins** _(cleaner: reine Chip/Reveal-Liste, statt großer Karte)_
7. **Online-Zeiten** (Stunden-Profil)
8. **Management-Logbuch** (Notizen/Memos)
9. **Verlauf-Tabelle** (unverändert)

## Entfernte Sektionen (nur UI, Code/Feature bleibt)

- **Voice-Memo-Sektion** komplett aus dem Profil raus (Funktion `handleGenerateVoiceMemo` und Import bleiben ungenutzt / können in Folge-Cleanup entfernt werden).
- **7-Tage-Trend / `WeekTrendCard`** aus dem Profil raus.

## Labels: neuer Header-Flow

- Direkt hinter dem Namen: horizontale Chip-Row der zugewiesenen Labels (max. 4 sichtbar, Rest als „+N").
- Ein kleiner **„+ Label"-Button** öffnet ein Popover:
  - Suchfeld
  - Liste aller Workspace-Labels mit Checkbox → Toggle
  - Inline „Neues Label" (Name + Farbtupfer, wie heute)
  - Neben jedem Label ein **Papierkorb-Icon** → löscht das Label workspace-weit (Confirm-Dialog, nutzt bestehende `deleteLabel`-Funktion)
- Chip-Klick im Header → Popover auf demselben Label vor-fokussiert (optional, nice-to-have)
- Bisherige große „Labels"-Sektion im Body entfällt.

## Models & Logins: cleaner

Statt der aktuellen breiten Karte:
- Kompakte Sektion „Models & Logins" mit einer Zeile pro Model:
  - Model-Name · Copy-Button für E-Mail · „Passwort anzeigen"-Toggle (Auge-Icon) · Copy-Button für PW
- Alles einzeilig, monospace-Werte, dezente Divider. Kein Header-Padding-Overkill.

## Technische Umsetzung

- Datei: `src/components/ChatterSlideOver.tsx`
  - Hero-Header (Zeile ~1379): neue `LabelChips` + `LabelPopover`-Komponente einhängen (im selben File, klein gehalten).
  - Body-Reihenfolge (Zeile 1573+) neu sortieren gemäß Liste oben.
  - Voice-Memo-JSX (~1734–1778) und 7-Tage-Trend-JSX (~1814–1817) entfernen.
  - Alte Labels-Sektion (~1656) entfernen.
  - Bestehende Handler `toggleLabel`, `createLabel`, `deleteLabel` bleiben.
- Kompakte Variante (inline/split, Zeile 858+): gleiche neue Reihenfolge & Header-Labels, entsprechend runter-skaliert. Die kompakte inline-Sektion (Zeile 1005 `{modelsLoginsBlock}`, 1073 Voice-Memo etc.) analog aufräumen.
- Keine DB-Änderungen, keine neuen Tabellen.
- shadcn `Popover` + `Command` sind bereits im Projekt vorhanden — für das Label-Popover verwenden.

## Was NICHT geändert wird

- Vergleichs-Modus-Symmetrie (letzter Fix bleibt).
- Datenpipeline / Backend / Migrations.
- Andere Views (Today, Models etc.).

## Offene Frage

Das **Löschen eines Labels aus dem Workspace** wirkt für ALLE Chatter (bestehende Funktion). Confirm-Dialog vorschalten? _Default-Vorschlag: ja — kurzer AlertDialog „Label X wirklich workspace-weit löschen?"_
