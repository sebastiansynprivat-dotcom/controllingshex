## Ziel
Auf der Auffälligkeiten-Seite soll ein Klick auf den Chatter-Namen direkt das Performance-Profil (ChatterSlideOver) öffnen, und vergebene Labels sollen pro Chatter-Zeile sofort sichtbar werden — auch wenn sie im SlideOver gerade neu zugewiesen wurden.

## Änderungen

### 1. Klick auf Namen → Profil öffnen (`src/components/AnomalyPanel.tsx`)
- Aktuell: Single-Click kopiert den Namen, Doppelklick öffnet das Profil.
- Neu: Single-Click öffnet direkt das Profil (`onChatterSelect(group.name)`).
- Copy-Funktion entfällt am Namen (Tooltip + `cursor-copy` ersetzen durch `cursor-pointer` und „Profil öffnen"-Tooltip). `copyName` wird nicht mehr benötigt.

### 2. Label-Chips pro Chatter-Zeile (`src/components/AnomalyPanel.tsx`)
- Beim Mount/Refresh zusätzlich `loadChatterLabels(platform)` und `loadLabelAssignments(platform)` aus `@/lib/chatter-labels` ziehen und in State halten.
- Pro Chatter eine `Map<chatter_key, ChatterLabel[]>` bauen (Lookup via `normalizeChatterName`).
- In der Chatter-Zeile (unter der Headline-Message, neben den Accounts) eine Reihe kleiner Label-Pills rendern: farbiger Punkt (`label.color`) + Label-Name, im bestehenden Pill-Stil (`bg-white/[0.02] border-white/[0.06]`). Max. 3 sichtbar, Rest als „+N".
- Wenn keine Labels: nichts rendern (keine Platzhalter).

### 3. Live-Sync nach Label-Änderung
- Neues Event `CHATTER_LABELS_UPDATED` in `src/lib/data-events.ts` ergänzen (`emit…` / `on…`), Payload optional `{ chatterName }`.
- `src/components/ChatterSlideOver.tsx`: in `toggleLabel` (assign + unassign) nach erfolgreichem DB-Write `emitChatterLabelsUpdated({ chatterName })` feuern.
- `AnomalyPanel.tsx`: in einem `useEffect` auf das Event hören und `loadLabelAssignments` (und ggf. `loadChatterLabels`, falls ein neues Label angelegt wurde) erneut laden.

## Technische Details
- Lookup-Key: `normalizeChatterName(group.name)`, identisch zur Logik in `chatter-labels.ts`.
- Kein Schema-Change, keine neue Tabelle, keine Migration.
- Anomalies-Page (`src/pages/Anomalies.tsx`) muss nicht angefasst werden — `onChatterSelect` ist bereits verdrahtet auf `ChatterSlideOver`.
- Dashboard nutzt `AnomalyPanel` ebenfalls (`variant="dashboard"`). Klick-Verhalten und Label-Chips greifen dort automatisch mit; gewünscht, da konsistent.
