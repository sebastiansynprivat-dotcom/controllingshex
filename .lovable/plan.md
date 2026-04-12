

## Problem: Warum "Failed to fetch" immer wieder kommt

Die Edge Function `analyze-csv` verarbeitet alle Batches (4 Stück bei ~170 Chattern) in einem einzigen HTTP-Request. Das dauert 2-4 Minuten. Die Verbindung wird nach ~150 Sekunden vom Server gekappt – daher "Failed to fetch". Die Recovery-Polling-Logik wartet dann auf ein fertiges Ergebnis in der Datenbank, aber die Edge Function ist ebenfalls abgestürzt (Log: `connection closed before message completed`), also wird das Ergebnis nie gespeichert.

**Kernproblem:** Ein einzelner HTTP-Request kann nicht 3+ Minuten lang laufen.

---

## Lösung: Client-seitige Batch-Orchestrierung

Statt alle Batches in einem einzigen Edge-Function-Call abzuarbeiten, wird der Client jeden Batch einzeln an eine schlanke Edge Function senden. Jeder Call dauert nur 30-60 Sekunden — weit unter dem Timeout-Limit.

```text
VORHER (bricht ab):
Client ──POST──> analyze-csv (4 Batches, 3+ min) ──TIMEOUT──> ❌

NACHHER (zuverlässig):
Client ──POST──> analyze-csv-batch (Batch 1, ~40s) ──OK──> ✅
Client ──POST──> analyze-csv-batch (Batch 2, ~40s) ──OK──> ✅
Client ──POST──> analyze-csv-batch (Batch 3, ~40s) ──OK──> ✅
Client ──POST──> analyze-csv-batch (Batch 4, ~40s) ──OK──> ✅
Client ──> Merge + Save to DB ──> 🎉
```

---

## Technische Schritte

### 1. Neue Edge Function `analyze-csv-batch`
- Nimmt entgegen: `header` (CSV-Kopfzeile), `batchLines` (Array von CSV-Zeilen), `platform`, `batchNum`, `totalBatches`
- Lädt Models und History aus der DB
- Lädt System-Prompt aus Settings
- Macht EINEN AI-Call mit Retry (max 3 Versuche)
- Gibt das Ergebnis direkt zurück: `{ result: { categories: [...] }, chattersReturned: N }`
- Keine Report-Speicherung — das macht der Client am Ende

### 2. Upload.tsx umbauen — Client orchestriert
- CSV/XLSX wird weiterhin lokal geparsed (ist schon so)
- CSV wird in Batches à 50 Zeilen gesplittet (client-seitig)
- Für jeden Batch: `fetch("analyze-csv-batch", { header, batchLines, platform, ... })`
- Nach jedem Batch: Live-Status-Update im UI ("Batch 2/4 fertig ✅")
- Wenn ein Batch fehlschlägt: bis zu 2 Retries, dann mit Warnung weitermachen
- Nach allen Batches: Ergebnisse mergen, Report in `analysis_reports` speichern
- chatter_history wird per separatem Call an die bestehende `analyze-csv` gespeichert ODER direkt via Supabase-Client

### 3. Bestehende `analyze-csv` Edge Function vereinfachen
- Wird nur noch als optionaler "save-history" Endpunkt genutzt ODER komplett durch die neue Batch-Funktion ersetzt
- Kann entfernt oder als Legacy beibehalten werden

### 4. Fortschrittsanzeige
- Progressbar zeigt "Batch 2 von 4" statt nur "Analyse läuft…"
- Jeder fertige Batch zeigt sofort die Chatter-Anzahl an
- Bei Fehler in einem Batch: klare Meldung welcher Batch betroffen ist

---

## Warum das bulletproof ist

| Problem | Lösung |
|---------|--------|
| HTTP-Timeout nach 150s | Jeder Call dauert max 60s |
| "Failed to fetch" | Kleine Payloads, kurze Calls |
| Edge Function crasht → kein DB-Save | Client speichert selbst nach allen Batches |
| Ein Batch-JSON ist kaputt | Retry pro Batch, Rest geht weiter |
| Verbindung kurz weg | Nur ein Batch muss wiederholt werden, nicht alles |
| Chatter fehlen | Client prüft nach jedem Batch die Coverage |

---

## Dateien die geändert/erstellt werden

1. **`supabase/functions/analyze-csv-batch/index.ts`** — Neue Edge Function (schlank, ein AI-Call)
2. **`src/pages/Upload.tsx`** — Client-seitige Batch-Orchestrierung, Live-Progress, Merge & Save
3. **`src/lib/analysis-pipeline.ts`** — Batch-Split-Logik als Helper exportieren (optional)

