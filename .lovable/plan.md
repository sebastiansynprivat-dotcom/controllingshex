## Änderungen an den Onboarding-Karten (Heute-Tab)

### 1. Neue Live-Tracking-KPIs aus `chatter_history_live`
Pro Chatter den neuesten Eintrag aus `chatter_history_live` ziehen (gefiltert auf Platform, `chatter_name`):
- **Offene Chats** → `unread_chats` (aktueller Live-Wert)
- **Chats offen seit** → `oldest_chat` (ältester unbeantworteter Chat; Anzeige z. B. „seit 3,2 h" / „seit 1,5 Tagen")

Beide werden in der zweiten Badge-Zeile als eigene Badges gerendert (Farbton: Amber/Orange, weil es Rückstand signalisiert).

### 2. Response-Time-Badge entfernen
Das Badge „⌀ Antwort X min" fällt komplett weg. Zugehöriges Feld `responseMedianMin` und die Sessions-Abfrage `first_response_min` werden aus `onboarding-filter.ts` entfernt (Datenquelle bleibt, wird nur nicht mehr für Onboarding geladen).

### 3. Mass-DMs-Quelle korrigieren
Aktuell überschreibt die Sessions-Aggregation den Report-Wert → erklärt die Abweichung zur Chat-Report-Anzeige.

**Fix:** Nur noch `chatter_history.mass_dms` verwenden. Berechnung:
- Summe `mass_dms` aller Tage des Chatters auf diesem Account ÷ Anzahl Tage mit `mass_dms > 0`
- Sessions-Override für Mass-DMs wird gelöscht

Damit stimmt der Ø-Wert mit dem überein, was im Chat-Report steht.

## Technische Details

**`src/lib/onboarding-filter.ts`**
- Interface `OnboardingChatter`: `responseMedianMin` entfernen, neu hinzufügen `liveOpenChats: number | null` und `liveOldestChatHours: number | null`
- KPI-Anreicherung: Sessions-Query entfernen, dafür Batch-Query auf `chatter_history_live` mit `.in("chatter_name", chatterNames).ilike("platform", platform)` → neuestes Update je Chatter (nach `updated_at`)
- Mass-DM-Aggregation: nur noch aus `chatter_history`, Sessions-Override löschen

**`src/components/today/OnboardingList.tsx`**
- `ChatterKpiRow`: Response-Badge raus, zwei neue Badges für „X offene Chats" und „seit Yh/Yd offen"
- Neue Formatter `fmtOldestChat(hours)` → `<1 h` / `3,2 h` / `1,5 Tage`

## Was bleibt unverändert
Account-Name, Follower, Account-Total-Revenue, Chatter-Revenue, „seit"-Badge, Filter-Chips, Swipe-Verhalten.
