## Problem

`/live` zeigt Chatter aus `chatter_history_live`, ohne sie gegen den neuesten Report abzugleichen. Wer im aktuellsten `analysis_report` nicht mehr vorkommt, taucht trotzdem in der Live-Liste auf.

Andere Bereiche (Daily-Todos, Recovery-Queue, Anomaly-Engine) nutzen bereits `loadActiveChatterNames(platform)` aus `src/lib/active-chatters.ts`, das genau diesen Filter liefert (oder `null`, wenn noch kein Report existiert → dann nicht filtern).

## Änderung (nur `src/pages/LiveTracking.tsx`)

1. Neuen State `activeNames: Set<string> | null` einführen.
2. In einem `useEffect([platform])` `loadActiveChatterNames(platform)` laden und in den State schreiben. Außerdem auf `chatter-data-updated` (über `onChatterDataUpdated`) hören und neu laden, damit ein frischer Upload sofort wirkt.
3. Vor dem Rendern (bzw. dort wo `rows` zu Status-Karten gemappt werden) filtern:
   - Wenn `activeNames === null` → keinen Filter anwenden (Fallback: noch kein Report da).
   - Sonst nur Zeilen mit `activeNames.has(normalizeChatterName(row.chatter_name))` durchlassen.
4. Den Realtime-Subscribe-Handler ebenfalls absichern: eingehende Events für Namen, die nicht in `activeNames` sind, werden ignoriert (kein State-Update für `liveActivityAt` etc.).

Keine DB-Migration, keine Backend-Änderung — die History bleibt erhalten, lediglich die UI versteckt nicht mehr aktive Chatter. Verhalten ist identisch zu Daily-Todos & Co.

## Verifikation

- Mit Report, der z. B. „Max" nicht mehr enthält: Max verschwindet aus `/live`, auch wenn `chatter_history_live` noch eine heutige Zeile hat.
- Solange noch nie ein Report hochgeladen wurde, bleibt Live-Liste unverändert (kein leerer Screen).
- Nach neuem Upload aktualisiert sich die Liste ohne Page-Reload (via `onChatterDataUpdated`-Event + Cache-Invalidierung in `active-chatters.ts`).
