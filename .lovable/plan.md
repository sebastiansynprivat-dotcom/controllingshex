

## Zeitraum-Toggle im Swipe-Mode

Im Swipe-Mode kommt oben ein **Zeitraum-Selector**, der die Karten dynamisch neu einsortiert basierend auf der Performance im gewählten Fenster. Inaktive Chatter (heute nicht mehr im aktuellen Report) fliegen automatisch raus. Der "Heute abhaken"-Mechanismus bleibt unverändert — egal welchen Zeitraum du gewählt hast, ein Check zählt für den heutigen Tag.

### Was du siehst

Neuer Pill-Selector über den Filter-Chips mit Presets:
- **Heute** (Default — aktuelles Verhalten)
- **Gestern**
- **Letzte 7 Tage**
- **Letzte 14 Tage**
- **Letzte 30 Tage**
- **Custom…** → öffnet Date-Range-Picker (Von / Bis)

Daneben ein kleiner Hinweis: `Re-Kategorisiert nach Ø Performance · X Tage`.

Die Karten + die Filter-Chips (SOFORT EINGREIFEN, COACHING NÖTIG, etc.) zeigen jeweils den **neu berechneten Bucket pro Chatter** für den gewählten Zeitraum. Beim Wechsel des Zeitraums siehst du sofort, wer wirklich z.B. **7 Tage** schwächelt vs. nur **heute** einen schlechten Tag hatte.

### Re-Kategorisierungs-Logik (basierend auf `chatter_history` im Fenster)

Pro Chatter werden die History-Rows im gewählten Datumsfenster aggregiert:
- **Tagesschnitt-Umsatz** = Ø `revenue_today` an Aktiv-Tagen
- **Null-Tage-Quote** = Anteil Tage mit `revenue_today = 0`
- **Max Response-Delay** im Fenster
- **Days Since Last Active** (letzter Tag mit `revenue_today > 0`)
- **Trend** = lineare Steigung Umsatz über das Fenster

Mapping (Priorität top-down, analog zur bestehenden Pipeline aber **fenster-basiert**):

| Bedingung im Fenster | Bucket |
|---|---|
| Null-Tage-Quote ≥ 80 % **oder** max Response-Delay > 3 Tage | 🆘 SOFORT EINGREIFEN |
| Null-Tage-Quote ≥ 50 % **oder** Trend stark fallend (≤ −30 %) | 💬 COACHING NÖTIG |
| Trend stark steigend (≥ +30 %) **oder** Onboarding-Phase im Fenster | 🚀 PUSHEN |
| Ø Umsatz top 20 % der Plattform im Fenster | 🎉 BELOHNEN |
| Performance vs. Tier-Erwartung > 50 % daneben | 📊 RE-ASSIGNEN |
| Sonst | 👀 BEOBACHTEN |

Bei `Heute` bleibt die bisherige Pipeline-Kategorie (aus dem letzten Report) — kein Recompute.

### "Nur aktive" Filter

Für jeden Zeitraum: Es werden nur Chatter angezeigt, die **im aktuellen letzten Report enthalten** sind (das ist heute aktiv). Wer nur in History-Rows aus dem Fenster vorkommt, aber heute nicht mehr im Report ist → wird **nicht** angezeigt.

### Tagesabhaken bleibt tagesgebunden

Die `daily_chatter_checks` Tabelle nutzt weiter `check_date = CURRENT_DATE`. Egal ob du den Zeitraum auf "Letzte 30 Tage" stehen hast — beim ✅-Swipe wird der Chatter **nur für heute** abgehakt und verschwindet aus der aktuellen Session. Morgen taucht er wieder auf, falls Re-Kategorisierung das so will.

### Persistenz

Der gewählte Zeitraum wird in `localStorage` gespeichert (`tinder.timeRange`), damit er beim Wiederkommen erhalten bleibt.

### Technische Details

**Geänderte Dateien:**
- `src/lib/timerange-categorize.ts` (neu) — `recategorizeByWindow(chatters, history, from, to, modelsList): Map<chatterName, ActionCategoryName>` + Helper für Aggregation/Trend
- `src/components/TimeRangeToggle.tsx` (neu) — Pill-Selector mit Presets + Custom Date-Range-Popover (`Calendar mode="range"` aus shadcn)
- `src/pages/TinderMode.tsx`:
  - State `timeRange: { preset, from, to }`
  - History-Fetch erweitern: bei Preset > 7 Tage paginiert via `.range()` laden (analog `loadHistoryWindow` in `swap-tracking.ts`)
  - `useMemo` `recategorizedMap` nach Window
  - `uniqueCategories`, `tierCounts`, Card-Sortierung und `categoryEmoji/Name` lesen aus `recategorizedMap` (Fallback auf Original-Kategorie wenn `Heute` aktiv)
  - Hinweis-Text mit "Re-Kategorisiert nach Ø Performance · X Tage"

**Datenfluss:** Beim Wechsel des Zeitraums wird **kein** neuer DB-Roundtrip nötig (außer beim ersten Mal, wenn das Fenster größer als die bereits geladenen 7 Tage History ist — dann wird einmalig nachgeladen und gecached).

**Edge Cases:**
- Chatter ohne History im Fenster → Bucket `BEOBACHTEN`
- "Custom"-Range mit `from > to` → automatisch tauschen
- "Gestern" = exakt 1 Tag (Min-Stichprobe = 1 Row)

