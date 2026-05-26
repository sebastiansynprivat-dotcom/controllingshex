## 90T-Preset für Zeitraum-Filter

1. `src/lib/timerange-categorize.ts`
   - `TimeRangePreset`-Union um `"90d"` erweitern.
   - `buildTimeRange`: `case "90d": return { preset, from: subDays(89), to: todayIso };`
   - `rangeLabel`: `case "90d": return "Letzte 90 Tage";`

2. `src/components/TimeRangeToggle.tsx`
   - In `PRESETS` nach `30T` einfügen: `{ id: "90d", label: "90T" }`.

Keine weiteren Anpassungen — `ModelTrackingView`, `TinderMode`, `AnomalyPanel`, `SwapModeView` reichen das Preset generisch durch.