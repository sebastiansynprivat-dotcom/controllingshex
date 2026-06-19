## Änderungen an `/push`

### 1. „Push"-Titel oben entfernen
- In `src/pages/Push.tsx` den `<h1>Push</h1>` + Untertitel entfernen.
- Triple-Tap Trigger wandert auf ein **unsichtbares Element** (kleiner 24×24px Spot oben rechts, transparent) — bleibt versteckt, weiterhin per 3 Taps öffenbar.
- Top-Padding leicht reduzieren, da der Header weg ist.

### 2. Settings-Sheet schließbar machen
Problem: Sheet öffnet sich, aber Schließen fühlt sich blockiert an (vermutlich verdeckt der scrollbare Inhalt den shadcn-X-Button oder Touch außerhalb wird nicht erkannt auf Mobile).

Fix:
- Expliziter, gut sichtbarer **„Fertig"-Button** ganz unten im Sheet, der `onOpenChange(false)` callt.
- Zusätzlich oben rechts ein zweiter Close-Button (X-Icon), damit auch beim Scrollen jederzeit erreichbar.
- `SheetContent` bekommt `onPointerDownOutside` nicht blockiert (Standard belassen) → Tap auf Overlay schließt ebenfalls.

### 3. Dritte Sektion: „Hot Leads idle"
Neue Counter-Karte unterhalb der bestehenden zwei:
- **Label:** „Hot Leads idle"
- **Sub:** „Gute Kunden online, ohne aktiven Chat"
- **Accent:** `amber` (neue Farbvariante in `PushCounterCard.tsx` — warmes Orange, passt zu „heißem Lead, der gerade liegen bleibt")
- Eigene `FakeCounterConfig` mit konservativeren Defaults (kleinere Range, z.B. 3–35, Step 1–4, Tick 2–6s — soll nach „seltener, wertvoller" wirken).

### 4. Settings erweitern
- `PushFakeConfig` bekommt drittes Feld `hotLeads: FakeCounterConfig`.
- `DEFAULT_PUSH_CONFIG` + `loadPushConfig` (Migration: fehlendes `hotLeads` → Default) in `src/lib/push-fake-counter.ts`.
- Neuer `CounterEditor`-Block „Hot Leads idle" im `PushSimulationSheet`.
- `onReroll`-Signatur erweitert: `"chatters" | "users" | "hotLeads"`.

### Geänderte/neue Dateien
- `src/pages/Push.tsx` — Header weg, unsichtbarer Trigger, dritte Karte einbinden
- `src/components/push/PushCounterCard.tsx` — `amber` Accent ergänzen
- `src/components/push/PushSimulationSheet.tsx` — dritter Editor + Close-Buttons
- `src/lib/push-fake-counter.ts` — `hotLeads` in Config + Defaults + Migration