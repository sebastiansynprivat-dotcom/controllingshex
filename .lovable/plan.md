## Änderungen am Bulk-Goal-Messages-Dialog

### 1. Chatter mit bereits gesetztem Ziel ausblenden
- `BulkTarget` um optionales Feld `currentGoal: number | null` erweitern.
- In `MonthlyGoals.tsx` beim Erstellen der `bulkTargets` den `currentGoal`-Wert aus `suggestions` mitgeben.
- Im Dialog vor dem Rendern filtern: Einträge mit `currentGoal != null` werden komplett **nicht** angezeigt (auch nicht in den Filter-Counts „Alle / WhatsApp / Plattform").
- Header-Count `({results.length})` zeigt die effektive Anzahl nach Filter.

### 2. Abhaken-Symbol oben auf jeder Karte
- Links neben dem Chatter-Namen ein klickbarer Kreis-/Check-Button (`Circle` → `CheckCircle2` beim Klick).
- Klick triggert `acceptGoal(chatter, goal)` → ruft den existierenden `onAccept`-Callback aus `MonthlyGoals` auf → Goal wird in DB gespeichert und optimistisch nach „Aktuelle Monatsziele" verschoben.
- Während Accept läuft: Spinner statt Check.
- Wenn fertig: grüner Check + die Karte bleibt sichtbar mit dezenter Opacity, damit User sehen welche schon abgehakt sind. (Alternative: ausblenden. Default = bleibt mit reduzierter Opacity, das matched besseren Workflow.)

### 3. Kopier-Button im WhatsApp-Tab entfernen
- In der WhatsApp-Karte (`classifyName === "whatsapp"`) wird der „Kopieren"-Button **nicht** mehr gerendert — nur der grüne WhatsApp-Button (kopiert weiterhin Text in Clipboard + öffnet WhatsApp).
- Plattform-Tab bleibt unverändert: Kopieren-Button wie bisher.

### 4. „Ziel beim Kopieren übernehmen"-Checkbox
- Bleibt erhalten (für Plattform-Tab-Workflow weiterhin nützlich). WhatsApp-Button respektiert sie ebenfalls beim Klick.

### Technische Details
- **Dateien**: `src/components/BulkGoalMessagesDialog.tsx`, `src/pages/MonthlyGoals.tsx`
- **Neue Imports**: `Circle`, `CheckCircle2` aus `lucide-react`
- **BulkTarget-Interface**: `currentGoal?: number | null` ergänzen (optional, default null)
- **Filter-Logik**: In `visibleResults` zusätzlich `results.filter(r => initialTargetMap.get(r.chatter)?.currentGoal == null)` — Map beim Init aus `targets` aufbauen
- **Counts**: `waCount` / `platformCount` ebenfalls auf gefilterte Liste berechnen
- **Card-Header**: Abhaken-Button linksbündig vor `r.chatter`, Größe `h-5 w-5`, hover-state, accent-Farbe emerald
