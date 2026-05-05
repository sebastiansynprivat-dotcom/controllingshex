# Live-Namen an History-Format angleichen

## Problem
Die Live-Daten in `chatter_history_live` kommen teilweise in komischen Schreibweisen rein (z.B. `benjamin kl`, `eva-maria he`, `Aleksandra Da` mit Leerzeichen am Anfang/Ende), während `chatter_history` saubere Title-Case-Namen hat (`Aaron Ha`, `Alexander Ho`). Dadurch matched die Live-Übersicht Profile/History nicht zuverlässig — manche Chatter "verschwinden" trotz vorhandener Daten, oder Profile zeigen keine Historie.

Im Code wird zwar überall via `normName()` (lowercase + trim) gematcht — aber die DB-Funktion `recompute_live_now` und das UI verwenden den **Display-Namen aus der Live-Zeile** als Anzeige, der dann nicht zur History-Karte passt.

## Lösung
Einmalige Normalisierung **beim Schreiben in `chatter_history_live`**, mit kanonischem Namen aus `chatter_history`.

### 1. Edge Function `upsert-chatter-live` anpassen
Vor dem Upsert für jeden eingehenden `chatter_name`:
1. `chatter_name.trim()` und Mehrfach-Whitespace zu Single-Space reduzieren.
2. Lookup in `chatter_history` per `lower(trim(chatter_name)) = lower(trim(input))` und gleicher `platform` → wenn Treffer: kanonischen Namen aus History verwenden (neueste Zeile gewinnt).
3. Kein Treffer → Title-Case-Fallback (`benjamin kl` → `Benjamin Kl`).

Damit ist ab dem nächsten Live-Push jeder Name exakt im History-Format. Bestehende UI-Logik (`normName`) bleibt unverändert und matched dann auch bei Display-Vergleich sauber.

### 2. Einmalige DB-Migration
Bestehende Zeilen in `chatter_history_live` aufräumen — selbe Logik in SQL:
- `UPDATE chatter_history_live l SET chatter_name = h.chatter_name FROM (SELECT DISTINCT ON (platform, lower(trim(chatter_name))) platform, chatter_name FROM chatter_history ORDER BY platform, lower(trim(chatter_name)), analysis_date DESC) h WHERE lower(trim(l.chatter_name)) = lower(trim(h.chatter_name)) AND lower(l.platform) = lower(h.platform) AND l.chatter_name <> h.chatter_name;`
- Restliche unmatched Namen: trim + Title-Case via SQL (`initcap`).

Anschließend `recompute_live_now()` einmal ausführen, damit `live_now_counts` frische Namen hat.

### 3. Nichts an der UI ändern
`src/pages/LiveTracking.tsx` und `ChatterSlideOver.tsx` brauchen keine Änderung — sie matchen bereits per normalisiertem Key, profitieren aber sofort vom konsistenten Display-Namen.

## Dateien
- `supabase/functions/upsert-chatter-live/index.ts` — Normalisierung + History-Lookup vor Upsert
- Neue Migration — Cleanup bestehender Live-Zeilen + `recompute_live_now()`
