## Ziel
Im Live-Tracking-Tab einen zusätzlichen Filter-Chip einbauen, der nur Chatter zeigt, die im aktuell eingestellten Live-Fenster (Default 15 Min, einstellbar 15/30/60) tatsächlich aktiv waren.

## Umsetzung in `src/pages/LiveTracking.tsx`

1. **FilterKey erweitern**
   - `type FilterKey = "all" | "live_now" | "active" | "weak" | "inactive";`

2. **Filter-Logik in `visible` (Zeile ~462)**
   - Neuen Branch ergänzen: bei `filter === "live_now"` prüfen, ob `normName(s.name)` im bereits berechneten `clientLive`-Set enthalten ist (Server-Cron + Realtime-Hits, exakt dieselbe Quelle, die das KPI-Badge "Jetzt online" speist — so bleiben Zahl und Liste konsistent).
   - Damit `clientLive` im Memo verfügbar ist, entweder als `useMemo` rauszuziehen oder direkt im `visible`-useMemo neu zu berechnen (cutoff = `Date.now() - liveWindowMs`).

3. **Counts (`counts`-Objekt, Zeile ~533)**
   - `live_now: liveNowCount` ergänzen, damit die Chip-Zahl mit dem Hero-KPI übereinstimmt.

4. **Filter-Chip-Reihe (Zeile ~669)**
   - Array auf `["all", "live_now", "active", "weak", "inactive"]` erweitern.
   - Label-Map: `live_now` → `"Jetzt online · Xm"` (mit aktuellem `liveWindowMin`), damit klar ist, dass das Fenster konfigurierbar ist. Optisch grüner Akzent (emerald), passend zum Live-Pulse oben.

5. **Bucket-Anzeige (Zeile ~763 ff.)**
   - Bei `filter === "live_now"` die normale Bucket-Aufteilung (weak/idle/inactive/strong) deaktivieren und stattdessen eine flache Liste rendern, sortiert nach `lastSeenSec` (frischeste zuerst). Sonst würden online-Chatter aus dem "strong"-Bucket im einklappbaren Accordion verschwinden — was bei einem "Wer ist gerade online?"-Filter unerwünscht ist.

## Nicht-Ziele
- Keine Änderungen an Datenmodell, Edge Functions oder DB.
- Keine Änderung am bestehenden Fenster-Setting (15/30/60 bleibt im Dropdown).
- Wording/Style: Lowercase-Chip-Style wie die anderen, kein Punkt vor Emoji (gemäß Memory).
