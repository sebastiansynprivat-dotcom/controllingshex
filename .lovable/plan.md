## Ablage (Drop-Zone) für Auffälligkeiten

Neue Drag-&-Drop-Ablage auf der Anomalies-Seite. Karten (rote Probleme oder grüne Highlights) können per Drag in eine floating Bottom-Bar gezogen werden und verschwinden dadurch dauerhaft aus der Übersicht — sowohl im Einzel- als auch im Vergleichs-Modus.

### Verhalten
- **Persistenz:** `localStorage` (überlebt Reload & Browser-Restart), Key z.B. `anomaly-tray-v1`.
- **Position:** Fixed Floating Bottom-Bar, mittig unten, einklappbar (Chevron). Zeigt Counter-Badge wenn eingeklappt.
- **Filterung:** Karten mit ID in der Ablage werden in `AnomalyPanel` aus problems/highlights herausgefiltert.
- **Zurücklegen:** Karte aus der Ablage zurück auf ein Panel ziehen ODER per "↺ Zurück"-Button pro Karte. Zusätzlich "Alle zurücklegen" und "Ablage leeren" im Header der Bar.

### Komponenten

**Neu:** `src/components/AnomalyTray.tsx`
- Floating Bar (fixed bottom, z-50), Glassmorphism-Style passend zum Dark-Theme.
- Header: Titel "Ablage", Counter, Collapse/Expand-Toggle, "Alle zurücklegen"-Button.
- Body: Horizontal scrollbare Mini-Karten (Name, Kind-Badge, Severity-Dot, ↺-Button). Drop-Target via `onDragOver`/`onDrop`.
- Empty State: gestrichelter Rahmen "Karten hierher ziehen" (nur sichtbar wenn Drag aktiv oder beim ersten Mal).

**Neu:** `src/hooks/use-anomaly-tray.ts`
- Hook mit `items`, `add(item)`, `remove(id)`, `clear()`, `has(id)`.
- Item-Shape: `{ id, chatterName, kind, severity, snapshot }` (snapshot = minimal nötige Felder zur Wiederanzeige in der Mini-Karte).
- Sync über `storage`-Event damit mehrere Tabs/Panels konsistent bleiben.

**Edit:** `src/components/AnomalyPanel.tsx`
- Akzeptiert neuen Prop `tray` (vom Hook) oder nutzt Hook intern.
- Karten bekommen `draggable={true}` + `onDragStart` (setzt `dataTransfer` mit Item-JSON).
- Filtert `problems`/`highlights` Listen: `.filter(p => !tray.has(p.id))`.
- Panel-Container wird Drop-Target für Rückgabe aus Ablage (entfernt Item aus Tray).

**Edit:** `src/pages/Anomalies.tsx`
- Rendert `<AnomalyTray />` einmal am Seitenende (außerhalb der Panels, damit beide Modi sie teilen).
- Body bekommt `padding-bottom`, damit Bar Inhalte nicht überdeckt.

### Technische Details
- Drag via native HTML5 DnD (kein neues Package nötig).
- IDs: bestehende Anomaly-IDs aus `AnomalyPanel` wiederverwenden.
- Tray-Items sind Workspace-übergreifend (kein Platform-Filter, analog Channel-Tab-Regel) — Frage falls anders gewünscht.
- Mobile: Bar bleibt sichtbar, Drag funktioniert auch via Touch (HTML5 DnD via PointerEvents-Fallback falls nötig).