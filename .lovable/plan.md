

## Analyse: Was passiert mit gekündigten Chattern?

### Aktueller Stand

**Swipe-Modus & Dashboard**: Laden aus dem **neuesten Report** (`analysis_reports.result_json`). Wenn ein Chatter im neuen CSV nicht mehr drin ist → wird er dort **nicht mehr angezeigt**. ✅ Funktioniert bereits korrekt.

**Leaderboard, History-Charts, Chatter-Details**: Laden aus der **`chatter_history`**-Tabelle, die historische Daten sammelt. Gekündigte Chatter bleiben dort **für immer sichtbar**, auch wenn sie seit Wochen keinen Report mehr haben. ❌ Problem.

### Plan

1. **Leaderboard filtern**: Nur Chatter anzeigen, die auch im **aktuellsten Report** vorkommen. Dazu den neuesten `analysis_reports.result_json` laden, die Namen extrahieren, und das Leaderboard-Query auf diese Namen einschränken.

2. **History/Details unverändert lassen**: Die Detail-Ansicht (ChatterSlideOver) und Trend-Charts zeigen historische Daten — das ist gewollt, solange der Chatter noch aktiv ist. Da sie nur über Klick auf aktive Chatter erreichbar sind, filtern sie sich automatisch.

3. **Runtime-Error fixen**: `normalizeChatterName is not defined` in `CategoryResultCards.tsx` — eine fehlende Funktion wird referenziert, die gefixt werden muss.

### Technische Details

- **Leaderboard.tsx**: Nach dem Query auf `chatter_history` die Ergebnisse gegen die Chatter-Namen des neuesten Reports filtern (ein zusätzliches Query auf `analysis_reports` für die aktive Namensliste).
- **CategoryResultCards.tsx**: Die Referenz auf `normalizeChatterName` an der fehlerhaften Stelle prüfen und sicherstellen, dass die Funktion dort erreichbar ist (vermutlich Scope-Problem durch Code-Refactoring).

