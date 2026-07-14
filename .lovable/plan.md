## Ziel
Zwei Verzug-Bugs im Heute-Tab beheben:

1. **Chatter erscheinen im Verzug-Tab, obwohl sie im letzten Report nicht mehr vorkommen.**
2. **Chatter, die laut Report im Verzug sind, tauchen nicht im Verzug-Tab auf** (z.B. weil sie unter Revenue/Recovery landen — oder gar nicht).

## Ursachen

### Bug 1 — Ex-Chatter im Verzug
- Der Roster-Filter (`loadActiveChatterNames`) beruht auf `analysis_reports.result_json.categories[].chatters[]`. Wenn ein Report defekt/leer geparst wird (z.B. `categories` fehlt/leer) → `hasReport=false` → **Filter aus** → historische Chatter aus 30 T History rutschen durch.
- Cache-TTL 60 s: kurz nach Upload wird noch alter Roster gecached.
- Fällt der Chatter aus einem alten Live-Snapshot (`chatter_history_live` gestern), erzeugt der Live-Pass in `daily-todos.ts` (Zeile 644 ff.) zwar `isActive`-geprüft — greift der Fallback aber nicht, ist er trotzdem drin.

### Bug 2 — Verzug fehlt trotz Rückstand
- Seit Umbau ist die Verzug-Todo-Erzeugung **ausschließlich Live-basiert** (`daily-todos.ts` Zeile 346–363, Kommentar „ausschließlich auf Live-Daten basiert"): nur wenn `chatter_history_live.oldest_chat >= 2`, wird ein `verzug`-Todo emittiert.
- Fehlt Live-Snapshot (nie gepullt, stale, oder Live zeigt oldest=1 weil kürzlich zugestellt) → **kein Verzug-Todo**, obwohl `chatter_history.response_delay_days` >= 2 sagt.
- Der Chatter bekommt dann nur ein `revenue`/`activity`-Signal → `primaryKind` fällt auf Revenue/Recovery zurück → er landet in einem anderen Tab.

## Umsetzung

### 1. `src/lib/active-chatters.ts` — härterer Roster
- Wenn `result.categories` leer/defekt ist, statt `hasReport=false` (Filter aus) **Fallback**: neuesten `analysis_reports.analysis_date` per Platform holen und daraus die Chatter aus `chatter_history` mit `analysis_date = <latest>` als Roster nehmen.
- Nur wenn wirklich gar kein Report existiert → weiterhin `null` (kein Filter).
- Kleiner Log-Warnhinweis wenn Fallback greift.

### 2. `src/lib/daily-todos.ts` — Verzug wieder auch aus Report speisen
- In der Haupt-Schleife (Zeile ~317) zusätzlich zum Live-Pass:
  - `reportDelay = max(response_delay_days) über todayEntries` (bereits als `todayMaxDelay` vorhanden, Zeile 331).
  - Wenn Live keinen Backlog liefert **aber** `reportDelay >= 2` **und** `todayOpenChats > 0` → Verzug-Todo mit `meta.delayDays = reportDelay`, Titel `„ältester Chat ${reportDelay}T (Report)"`, `why`-Text weist auf fehlende Live-Bestätigung hin.
  - Wenn Live zeigt „oldest=0 & unread=0" (frisch), und `liveAgeMin < 60` → Report-Fallback unterdrücken (Live hat gerade bestätigt: aufgeräumt).
- Live-Pass (Zeile 644 ff.) bleibt für Chatter ohne History-Row.

### 3. `src/pages/Today.tsx` — Belt-&-Suspender Roster-Check
- Vor dem Rendern der Verzug-Liste: `loadActiveChatterNames(platform)` einmalig laden und `visibleList` im `verzug`-Tab hart auf aktive Namen filtern (falls Fallback in Punkt 1 noch etwas durchlässt).
- Bei Wechsel auf Verzug-Tab (`kindTab === "verzug"`) `invalidateActiveChattersCache(platform)` einmalig triggern, damit ein frisch hochgeladener Report sofort greift.

### 4. Verifikation
- Nach Fix Playwright:
  1. `/today` → Verzug-Tab öffnen, Screenshot der Kartenliste.
  2. Console-Check auf `[daily-todos]` / `[active-chatters]` Warnings.
- Manuelle Konsistenz: aus `chatter_history_live` per SQL Chatter mit `oldest >= 2` ziehen und mit UI abgleichen (nicht im PR, nur Notiz zur Validierung).

## Nicht im Scope
- Keine Änderung an anderen Tabs (Revenue, Recovery, Upgrade).
- Keine DB-Migration.
- Keine Änderung an `today-engine` Bündelungs-/Priorisierungslogik — Verzug hat bereits höchste Priorität; wir sorgen nur dafür, dass der Verzug-Signal überhaupt entsteht bzw. der Roster stimmt.