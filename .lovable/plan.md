## Ziel
Im Vergleichsmodus (Upgrade ↔ Downgrade) eine schwebende **Ablage** einbauen, in die man Karten per Drag & Drop legen kann, um Paare zu sammeln, abzuhaken und direkt Profil-für-Profil zu vergleichen.

## User-Flow

1. Vergleichsmodus wird aktiv → unten rechts erscheint ein fixierter **Ablage-Button** (kleiner Kreis mit Zähler-Badge).
2. Nutzer zieht eine Karte (Upgrade oder Downgrade) auf den Kreis → Karte verschwindet aus der Spalte und landet in der Ablage.
3. Klick auf den Kreis öffnet ein Panel/Popover mit allen abgelegten Karten, gruppiert in **Upgrade** und **Downgrade**.
4. In der Ablage kann jede Karte:
   - abgehakt werden (Häkchen → endgültig erledigt, verschwindet auch nach Neu-Laden aus der Ansicht),
   - zurück in die Liste geschoben werden (kleines „×"),
   - per **Vergleichen**-Button neben einem Upgrade + Downgrade → öffnet beide Profile side-by-side (nutzt vorhandenes `ChatterSlideOver` mit `compareWith`).
5. Oben in der Ablage: **Vergleich starten**-Button, der aktiv wird, sobald genau **1 Upgrade + 1 Downgrade** ausgewählt sind.

## UI-Details

- Ablage-Button: 56px Kreis, `fixed bottom-24 right-4` (über der Bottom-Nav), leichter Glow, Badge mit Anzahl.
- Nur sichtbar, wenn `compareActive === true`.
- Drop-Zone: Kreis vergrößert sich + grüner Ring beim Hover-Drag.
- Panel: gleitet von rechts unten auf, max. 360px breit, glassy Card im Projekt-Stil (kein Hardcode-Weiß, Design-Tokens).
- Cards in der Ablage: kompakte Variante (Name, Kind-Badge, Mini-Metric, Aktionen: Vergleichen · Abhaken · Zurück).

## Technische Umsetzung

- **Neue Komponente** `src/components/today/CompareTray.tsx`
  - Props: `upgradeItems`, `downgradeItems`, `onCheckOff(action)`, `onReturn(action)`, `onCompare(upgradeAction, downgradeAction)`.
  - Interner State: `open` (Panel), `selection` (jeweils ein Upgrade/Downgrade highlighted).
- **State in `Today.tsx`**:
  - `trayIds: Set<string>` (bundleKey) – über `localStorage` persistiert pro Platform (`today.compareTray.<platform>`), damit die Ablage über Reloads erhalten bleibt.
  - `checkedTrayIds: Set<string>` – ebenfalls persistiert; diese Actions werden aus `upgradeList`/`downgradeList` gefiltert, ähnlich wie bereits Done-Status.
- **Filter der Spalten**: `upgradeList` und `downgradeList` werden vor dem Rendern um `trayIds` und `checkedTrayIds` reduziert. Ablage-Panel bekommt die Vollobjekte über eine `Map<bundleKey, UnifiedAction>`.
- **Drag & Drop**: Native HTML5 DnD (`draggable`, `onDragStart`, `onDragOver`, `onDrop`) – reicht für Desktop; auf Touch fällt ein Long-Press-Fallback dazu (kleiner „In Ablage"-Button unten in der Karte, damit mobil nichts verloren geht).
  - `PersonActionCard` bekommt optionale Props `draggable`, `onDragStart`, `onSendToTray` – nur im Vergleichsmodus gesetzt, sonst unverändert.
- **Abhaken**: nutzt vorhandene `act()`-Funktion mit Status „done" (analog Bottom-Bar-Done-Flow), damit es sich mit `todo_state`/`action-outcomes` deckt. Falls das für Upgrade/Downgrade nicht sinnvoll ist, alternativ ein lokal persistiertes „dismissed" mit Reset-Option in der Ablage.
- **Vergleich-Button**: ruft `setSelectedChatter({ name: upgrade.chatterName, compareWith: downgrade.chatterName })` – die bestehende Split-View im `ChatterSlideOver` übernimmt den Rest.

## Was NICHT geändert wird

- Kein Umbau der Datenpipeline (`today-engine`).
- Kein neues DB-Schema; Persistenz nur `localStorage`. Bei Bedarf später auf Supabase heben.
- Single-Modus, andere Tabs, Bottom-Nav bleiben unverändert.

## Offene Frage

Soll „Abhaken" **dauerhaft** (per Server via `recordActionDone`) speichern, oder nur **lokal** (verschwindet nur auf diesem Gerät bis zum nächsten Report)? Default-Vorschlag: **dauerhaft via `act("done")`**, damit es auch im Wins-Feed landet – lässt sich beim Umsetzen kurz bestätigen.
