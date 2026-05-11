## Ziel

In der **Heute**-Liste eine neue Aufgabenart einführen:  
„Aufsteiger entdeckt — vergleiche mit Underperformer."

Wenn ein Chatter ab **Onboarding-Tag 5** auffällig stark performt (Aktivität, MassDMs, Reaktion), aber auf einem zu kleinen Account sitzt, soll vorgeschlagen werden, ihn mit einem Chatter zu vergleichen, der einen besseren Account hat, ihn aber nicht ausschöpft (lange offene Chats, niedriger Umsatz/Follower, wenig MassDMs).

Beim Klick auf die Aufgabe öffnet sich direkt der **Wechselmodus → Vergleichsansicht** mit beiden Chattern vorausgewählt.

---

## Aufbau (3 Bausteine)

### 1. Talent-Scout (neue Logik)

Neue Datei `src/lib/talent-scout.ts` mit Funktion `findTalentMatches(platform)` → liefert pro qualifiziertem Aufsteiger einen Vorschlags-Chatter zum Vergleich.

**Auswahl Aufsteiger („left" / underplaced):**
- `onboarded_on` ≤ heute − 5 Tage UND ≤ heute − 21 Tage *nicht* (also Tag 5–21, junges Onboarding)
- **mindestens 5 Live-Sessions** in den letzten 7 Tagen (`chatter_activity_sessions` via `get_live_efficiency`)
- **MassDMs ≥ 4/Tag** Schnitt
- **Reaktionszeit-P50 ≤ 30 min** ODER **Konsistenz ≥ 0.7**
- aktuell auf Tier `seed` oder `starter` (kleiner Account) — via `models.follower_count`

**Auswahl Vorschlags-Partner („right" / overplaced):**
- Tier `growth` oder `top` (besserer Account)
- **mind. 14 Tage onboarded** (etabliert)
- EINES dieser Underuse-Signale (7-Tage-Schnitt):
  - `avgResponseDelay ≥ 2 Tage` ODER
  - `avgOpenChats` ≥ 30 UND > 1.5× Pool-Median ODER
  - €/Follower deutlich unter Pool-Median für sein Tier (Peer-Benchmark)

**Pairing:** für jeden Aufsteiger den passendsten Underuser nach `expectedGain` (vorhandene `computeSwapExpectedGain`) wählen, max. 1 Vorschlag pro Aufsteiger, max. 5 pro Tag.

### 2. Neue Todo-Kategorie

In `src/lib/daily-todos.ts`:
- Neue Kategorie `"talent"` zu `TodoCategory` hinzufügen  
- `CATEGORY_META` in `DailyTodoList.tsx` ergänzen (Icon `Sparkles` o. `TrendingUp`, emerald/blue Farbschema, Label „Talent")
- In `generateDailyTodos`: nach den bestehenden Blöcken `findTalentMatches()` aufrufen, Ergebnisse als Todos anhängen.

Pro Match ein Todo:
```
title: "🚀 Anna prüfen — Aufsteiger seit 6 Tagen"
why:  "Stark in Aktivität (5,2 MassDMs/Tag · 18min Reaktion) auf seed-Account.
       Vergleiche mit Tom (top, 12k Follower, Ø 3 Tage Verzug)."
score: 70 (über Standard-Aktivität, unter Verzug)
chatterName: "Anna"
extra: { compareWith: "Tom" }   ← neues optionales Feld auf DailyTodo
```

### 3. Sprung in die Vergleichsansicht

**Erweitere `DailyTodo`-Interface:**
```ts
compareWith?: string | null;   // Chatter-Name für Vergleich
```

**Routing-Mechanismus** (zwei Varianten — empfohlen ist (a)):

**(a) URL-Param + Event-Bus (leichtgewichtig):**
- `DailyTodoList` ruft bei Klick auf Talent-Todo `navigate("/swipe?mode=swap&compare=Anna|Tom")` auf  
- `TinderMode.tsx` liest `searchParams` beim Mount, setzt internen Mode auf `"swap"`, öffnet direkt `CompareModeView` mit den beiden vorausgewählten Chattern, bereinigt URL danach.

**(b) Globaler Context** (`SwapCompareContext`) — overkill für einen Use-Case.

→ **Wir nehmen (a).** Falls `TinderMode` aktuell die Compare-View nur intern öffnet, ergänzen wir eine `initialCompare`-Prop bzw. einen `useEffect`, der bei Param-Match `CompareModeView` mit `chatterA={compare[0]}` und `chatterB={compare[1]}` rendert.

---

## Technische Details

**Datenquellen (alle vorhanden):**
- `get_live_efficiency` RPC → MassDMs, €/h, Reaktionszeit, Konsistenz, Sessions
- `get_chatter_onboarding` RPC → onboarded_on
- `chatter_history` (7 Tage) → Verzug, offene Chats für Underuser
- `models.follower_count` + `tierForFollowers` → Tier-Einordnung

**Schwellen** (zentral in `talent-scout.ts` als Konstanten, einfach anpassbar):
```ts
const ONBOARDING_MIN_DAYS = 5;
const ONBOARDING_MAX_DAYS = 21;
const MIN_LIVE_SESSIONS = 5;
const MIN_AVG_MASSDMS = 4;
const MAX_RESPONSE_P50_MIN = 30;
const MIN_CONSISTENCY = 0.7;
const UNDERUSER_MIN_DELAY_DAYS = 2;
const UNDERUSER_MIN_OPEN_CHATS = 30;
```

**Performance:** alle Daten bereits in einem Aufruf in `daily-todos`-Pipeline geladen, eine zusätzliche RPC pro Tag.

**Keine DB-Migration nötig** — alle Tabellen/Funktionen existieren bereits.

---

## Out of Scope

- Keine Änderung an `swap-suggestions.ts`-Algorithmus selbst.
- Keine neue UI-Seite — nur Erweiterung der Heute-Liste + Routing-Hook in `TinderMode`.
- Kein automatischer Account-Tausch — nur Vorschlag zum Vergleichen, Entscheidung bleibt manuell.

---

## Schritte

1. `src/lib/talent-scout.ts` neu — Aufsteiger-/Underuser-Erkennung + Pairing.
2. `src/lib/daily-todos.ts` — Kategorie `talent` + `compareWith`-Feld + Aufruf von `findTalentMatches`.
3. `src/components/DailyTodoList.tsx` — `CATEGORY_META.talent`, Klick-Handler navigiert mit `?mode=swap&compare=…` statt `onChatterClick`.
4. `src/pages/TinderMode.tsx` — `useSearchParams` lesen, Mode auf `swap` setzen, `CompareModeView` mit beiden Chattern öffnen, Param wieder entfernen.
5. Smoke-Test: Heute-Liste rendert neue Karte, Klick öffnet Vergleichsansicht korrekt.
