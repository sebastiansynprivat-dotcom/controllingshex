## Ziel
Chatter, die nach **≥ 4 Tagen ohne Aktivität** heute wieder online sind, erscheinen automatisch als eigene Action-Karte im Heute-Tab — damit kein Wake-Up untergeht.

## Trigger-Logik
Ein Chatter qualifiziert sich, wenn **beide** Bedingungen erfüllt sind:

- **Schlaf:** in den letzten 4 Tagen (heute exkl.) entweder **kein** Eintrag in `chatter_history` ODER an allen Tagen `revenue_today = 0` UND `mass_dms = 0`
- **Wake-Up heute:** in `chatter_history` (heute) ODER `chatter_history_live` (heute) mindestens eines:
  - `revenue > 0`
  - `mass_dms > 0`
  - oder hat heute aktiv Chats abgebaut (`unread_chats` < gestern)

Voraussetzung: Chatter muss in den letzten 30 Tagen mindestens **einmal** schon mal Umsatz gemacht haben (sonst ist es ein neuer Chatter, kein Wake-Up).

## Signal-Aufbau
- **Title:** „Wieder aktiv nach 5 Tagen"
- **Why:** „War 5 Tage still — heute X € / Y Mass-DMs / Z Chats abgebaut. Jetzt 30 s reinrufen, bevor wieder Funk weg."
- **Impact-Schätzung:** historischer Median × 7 × 0,5 (50 % Rückgewinn-Annahme), gecappt auf 2× Wochenmedian. Bei zu wenig Historie: `null` (zeigt „?").
- **Tone:** `info` (kein Krisen-Rot, aber priorisiert)

## Code-Änderungen

### `src/lib/today-engine.ts`
- `ActionSourceKind` erweitern um `"wakeup"`
- `TONE_BY_KIND.wakeup = "info"`
- `KIND_PRIORITY`: `wakeup` direkt **nach** `recovery` einsortieren (hoch oben, damit es im Primary-Block landet)
- `KIND_DEFS` (in Today.tsx): Eintrag für `wakeup` mit Icon `BellRing`, Label „Wieder aktiv", Akzent `text-emerald-300`
- Neue Funktion `detectWakeups(platform, stats)` direkt im Modul:
  - Lädt `chatter_history` (analysis_date ≥ heute−4) und `chatter_history_live` (date = heute)
  - Iteriert über alle bekannten Chatter aus `stats` (haben ≥ 1 aktiven Tag in 30T-Historie)
  - Prüft Schlaf + Wake-Up-Bedingung
  - Emittiert `ActionSignal` mit `source: "revenue"`, `kind: "wakeup"`, eindeutiger `todoKey: \`wakeup:${chatter}:${todayISO()}\``
- In `buildTodayActions` aufrufen und Signale ans Bündel hängen (nicht solo — wenn der Chatter zufällig auch andere Signale hat, dürfen die zusammen)

### `src/pages/Today.tsx`
- `KIND_DEFS` um `wakeup`-Eintrag ergänzen (Icon `BellRing` aus lucide-react)

## Bewusst NICHT geändert
- Kein neuer DB-Trigger / keine neue Edge-Function — alles wird live im Frontend aus vorhandenen Tabellen berechnet
- Keine Änderung an Score-Boost-Faktoren — `kindBoost` bleibt für `wakeup` neutral (1.0); die Sortierung ergibt sich automatisch über Impact + Importance
- Persistence/Streak-Logik unverändert
