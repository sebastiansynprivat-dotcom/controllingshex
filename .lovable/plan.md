

## Plan: Model-Performance-Tracking pro Chatter

### Was du willst
- Direkt auf der Chatter-Karte sehen: welches Model, wie viele Follower, und ob die Performance passt
- Historisches Tracking: wenn ein Model von Chatter A zu Chatter B wechselt, bleibt die alte Performance gespeichert
- Warnung, wenn ein Chatter schlechter performt als der vorherige Chatter auf demselben Model

### Schritt 1: Datenbank erweitern

**`chatter_history` bekommt eine neue Spalte `account`** (text, nullable), damit bei jedem Upload gespeichert wird, welcher Chatter welches Model hatte.

```sql
ALTER TABLE chatter_history ADD COLUMN account text;
```

Das ermöglicht: "Zeig mir alle Chatters, die jemals Model X hatten, und deren Umsätze."

### Schritt 2: Upload-Logik anpassen

In `src/pages/Upload.tsx` und `supabase/functions/analyze-csv/index.ts` wird beim Speichern in `chatter_history` das `account`-Feld mitgespeichert (kommt bereits aus der Pipeline).

### Schritt 3: Model-Performance-Vergleich berechnen

Neue Hilfsfunktion, die pro Model:
1. Alle Chatters findet, die dieses Model jemals hatten (aus `chatter_history`)
2. Deren Durchschnittsumsatz berechnet
3. Den aktuellen Chatter mit dem vorherigen vergleicht
4. Status zurückgibt: `besser` / `schlechter` / `gleich` + Prozent-Differenz

### Schritt 4: Chatter-Karte (Dashboard + Swipe Mode) erweitern

Jede Karte zeigt:
- **Model-Badge**: Account-Name + Follower-Anzahl (z.B. `ModelXY · 45K`)
- **Performance-Indikator**: Farbiger Dot oder kleines Badge
  - Grün: performt besser als der vorherige Chatter auf diesem Model
  - Rot: performt schlechter (mit %-Angabe, z.B. "−32% vs. Vorgänger")
  - Grau: erster Chatter auf diesem Model oder keine Vergleichsdaten

### Schritt 5: Warnungs-Kategorie in Pipeline

In `analysis-pipeline.ts` (`step2_categorize`): Wenn Vergleichsdaten zeigen, dass der aktuelle Chatter deutlich schlechter performt (z.B. >30% weniger Umsatz als der Vorgänger auf demselben Model), wird eine spezielle Warnung generiert.

### Dateien die geändert werden

| Datei | Änderung |
|---|---|
| Migration (SQL) | `account`-Spalte zu `chatter_history` |
| `src/pages/Upload.tsx` | `account` beim Speichern mitsenden |
| `supabase/functions/analyze-csv/index.ts` | `account` in History-Rows |
| `src/components/CategoryResultCards.tsx` | Model-Badge + Performance-Vergleich auf Karte |
| `src/components/SwipeCard.tsx` | Model-Badge + Performance-Indikator |
| `src/pages/TinderMode.tsx` | Vergleichsdaten laden und an SwipeCard übergeben |

