## Ziel

Die Heute-Liste in „Jetzt machen" (und konsistent auch „Im Auge behalten") wird in drei thematische Untergruppen aufgeteilt, damit auf einen Blick klar ist, *welche Art* von Aktion ansteht. Tabs oben bleiben wie sie sind.

## Gruppen

```text
🚨 Eskalation        → kinds: verzug, recovery
💱 Account-Aktionen  → kinds: swap, talent, mismatch, phase
📊 Performance       → kinds: revenue, activity, model, slot, positive
```

Jede Gruppe bekommt einen schlanken Sticky-Header mit Icon, Label, Anzahl und Summe €/Wo. Innerhalb der Gruppe werden Karten weiterhin nach Tone + €-Hebel sortiert (bestehende Reihenfolge aus `today-engine.ts` bleibt unangetastet — wir gruppieren nur in der Render-Ebene).

Leere Gruppen werden komplett ausgeblendet (kein leerer Header).

## Layout

```text
┌─ 🚨 Eskalation · 3 · +1.240€/Wo ────────┐
│  [Card] [Card] [Card]                   │
└─────────────────────────────────────────┘
┌─ 💱 Account-Aktionen · 2 · +680€/Wo ───┐
│  [Card] [Card]                          │
└─────────────────────────────────────────┘
┌─ 📊 Performance · 4 · +320€/Wo ────────┐
│  [Card] [Card] [Card] [Card]            │
└─────────────────────────────────────────┘
```

- Header: kleines Icon + uppercase tracking-wider Label links, Count + €-Summe rechts (tabular-nums), feiner Divider darunter.
- Abstand zwischen Gruppen größer (`space-y-5`) als zwischen Karten (`space-y-2`).
- In den Tabs „Wins" und „Erledigt" wird **nicht** gruppiert (dort macht Thema keinen Sinn) — bleibt flach.
- „Im Auge behalten" wird ebenfalls gruppiert, gleiche Logik.

## Technische Umsetzung

Nur eine Datei betroffen: `src/pages/Today.tsx`.

1. Helper `groupByTheme(actions: UnifiedAction[])` direkt in der Datei:
   - Map `kind → group` (escalation/account/performance)
   - Gruppe wird durch `action.primaryKind` bestimmt
   - Rückgabe: `{ id, label, icon, accent, items, sumImpact }[]` in fester Reihenfolge, leere Gruppen rausgefiltert
2. Im Render-Block (`visibleList.map(...)`):
   - Wenn `section === "primary" || section === "watch"` → über Gruppen iterieren und je Gruppe Header + Karten rendern
   - Sonst (wins/done) → bestehender flacher Render
3. Gruppe-Header als kleine inline-Komponente `<GroupHeader>` mit den oben beschriebenen Tokens. Farbakzent dezent pro Gruppe (rot-300/cyan-300/emerald-300), keine neuen CSS-Variablen nötig.

Alle Card-Logik, Swipe, Vergleichsansicht, Aktionen bleiben unverändert — rein eine Render-Schicht obendrauf.

## Out of scope

- Keine Änderung an `today-engine.ts`, `PersonActionCard.tsx`, Sortierung, Bündelung, Tab-Struktur.
- Keine neuen DB-Felder.
