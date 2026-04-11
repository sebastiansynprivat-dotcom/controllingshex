

## Plan: Cache beim Plattform-Wechsel leeren

### Änderung

In `src/pages/Dashboard.tsx` wird beim Plattform-Wechsel das gespeicherte Analyse-Ergebnis zurückgesetzt. Der bestehende `useEffect` für den Cache-Load wird erweitert: Wenn für die aktuelle Plattform kein Cache vorhanden ist, werden `result`, `file`, `csvData` und `statusLog` explizit geleert.

### Technisch

- Im `useEffect([platform])` in `Dashboard.tsx`: Wenn kein passender Cache gefunden wird → `setResult(null)`, `setFile(null)`, `setCsvData("")`, `setStatusLog([])`
- Eine Zeile Änderung im bestehenden Effect-Block

