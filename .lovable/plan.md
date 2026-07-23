
# Coaching v3 — Story-Feed für Chatter

Ziel: Chatter versteht sofort *worum* es geht, *warum* ihn das Geld kostet und *wie* er es besser macht. Aufgebaut wie ein Instagram-Story-Feed: eine Karte nach der anderen, Vollbild, swipen/tappen. B1-Sprache, viele Bilder/Emojis, wenig Text pro Screen.

---

## 1. Neue Story-Feed Architektur (`/c/:token`)

Ersetzt die aktuelle scrollende Seite durch einen **Vollbild-Karten-Reader** (wie Stories):
- Untere Progress-Bar zeigt Fortschritt durch alle Karten
- Tap rechts = weiter, tap links = zurück, swipe hoch = Details
- „Weiter"-Button unten, nie mehr als 1 Karte pro Screen
- Fortschritt wird pro Karte in `progress_json` gespeichert → beim Reopen springt er zurück wo er war
- Am Ende: Abschluss-Screen mit XP, Level-Up, Share-Button

### Kartentypen (in dieser Reihenfolge pro Hebel)

1. **Cover** — „Hey Jeanette, das hier bringt dir diese Woche +340 €"
2. **Vorwochen-Vergleich** — nur einmal am Anfang, groß & emotional
3. **Kunden-Karteikarte** (pro Hebel) — Alias, Ausgaben bisher, Kink, Stimmung, letzte Aktion. Als Trading-Card designed.
4. **Original-Verlauf** — aufklappbare Chat-Bubbles der 5-10 vorigen Nachrichten (echter Kontext)
5. **Situation-Story** — 2-3 Sätze: „Der Kunde war grade heiß, hat X geschrieben, du hattest die Chance auf Y"
6. **„Was du gemacht hast"** — Original-Antwort des Chatters als Bubble
7. **„Was es dich gekostet hat"** — Geld-Rechner-Karte („Dieser eine Move = -85 €. Bei 20x diese Woche = -1.700 €")
8. **„So macht's ein Top-Chatter"** — Musterantwort im **Stil des Chatters** (Mimikry bleibt)
9. **Mini-Drill** — kurze Übung: 2 Antworten, Chatter tippt „welche ist besser?" → Feedback
10. **Tipp-Übung** — Chatter tippt selbst eine Antwort auf gleiche Situation, KI bewertet (1 Runde)
11. **Story vom Boss** — „Ich hatte mal genau die Situation. Kunde X, hab Y gemacht, +2.400 € an einem Abend." (Anekdote als Autorität)
12. **Take-away-Karte** — 1 Satz zum Merken, groß, screenshot-bar

Am Ende aller Hebel:
13. **Boss-Fight Simulator** — Multi-Turn (3-5 Nachrichten). KI spielt Kunden, Chatter navigiert bis zum Sale. Score am Ende.
14. **Ranking-Karte** — „Du bist grade Platz X im Team. Wenn du diese Hebel fixst → Platz Y."
15. **Commitment** — Chatter tippt eine Zeile: „Ich verspreche diese Woche ___". Wird gespeichert und bei Reopen gezeigt.

---

## 2. Gamification-Layer

- **XP pro Karte** (Weiter = +10, Drill richtig = +25, Sim bestanden = +100)
- **Level & Titel** — „Rookie / Closer / Shark / Legende" — sichtbar oben rechts
- **Streak** — Tage in Folge mit abgeschlossenem Coaching
- **Badges** — „Erstes Coaching", „Alle Drills 100 %", „Boss-Fight Sieger"
- **Progress-Bar** unten, immer sichtbar
- Speicherung in `progress_json` (bereits vorhanden) + neuer Spalte `xp_earned int`

---

## 3. Manipulativer Push

Bewusst emotional geladene Karten zwischen die Hebel gestreut:
- **Geld-Rechner** in Rot: „Dieser Fehler kostet dich pro Woche X €, pro Jahr Y €" (Loss-Aversion)
- **Whale-Warnung**: „63 % deines Umsatzes kamen von 1 Kunden. Wenn der weg ist…"
- **Team-Vergleich**: „Anna hat aus der gleichen Situation +180 € rausgeholt. Du 0 €."
- **Persönliche Ansprache** in jeder Karte („du", nie „ihr", Vorname)
- **Story-Anekdoten des Bosses** als soziale Bewahrheit
- **Countdown**: „Diese Woche noch 4 Tage — schaffst du +500 €?"

---

## 4. Interaktive Übungen (beide Modi)

**Pro Hebel (Soft/1-Runde):**
- Multiple-Choice: „welche der 2 Antworten ist besser?" + Erklärung
- Tipp-Feld: Chatter tippt Antwort → KI-Feedback via neuer Edge Function `evaluate-coaching-drill`

**Am Ende (Boss-Fight/Multi-Turn):**
- KI simuliert Kunden über 3-5 Turns
- State-machine im Frontend, jeder Turn → `evaluate-coaching-simulation` (existiert bereits, wird erweitert für Multi-Turn Context)
- Am Ende: Score, „Umsatz erzielt: X €", Sterne

---

## 5. Kontext-Tiefe (Karteikarte + voller Verlauf)

**Kunden-Karteikarte** als eigene Karte vor jeder Analyse:
```
┌─────────────────────┐
│ 🎭 „BigSpender_92"   │
│ Ausgegeben: 340 €   │
│ Kink: Feet, Domina  │
│ Stimmung: heiß 🔥   │
│ Letzte Aktion:      │
│ „Zeig mir mehr..."  │
└─────────────────────┘
```

**Voller Verlauf** als aufklappbare Karte darunter — Original-Chat-Bubbles der letzten 5-10 Nachrichten (aus `chats_preview.chat`).

AI-Prompt wird erweitert: pro Hebel muss `customer_card` (Alias, spend, kink, mood, last_action) + `context_messages` (Array der Vor-Nachrichten) im Schema.

---

## 6. Datenbank-Änderungen

Migration auf `coaching_analyses`:
- `xp_earned int default 0`
- `current_card_index int default 0` (für Resume)
- `commitment_text text` (Chatter's Versprechen)
- `boss_fight_result jsonb` (Multi-Turn Sim Ergebnis)

`generate-coaching-analysis` Schema erweitert um:
- `customer_card` pro Hebel
- `context_messages` (Vor-Nachrichten) pro Hebel
- `drill` (2-Antworten-Vergleich) pro Hebel
- `boss_scenario` (Multi-Turn Kunden-Persona) einmal pro Analyse
- `boss_anecdote` (Story vom Chef) pro Hebel

Neue Edge Function `evaluate-coaching-drill` für Tipp-Übungen.
`evaluate-coaching-simulation` wird erweitert um Multi-Turn Context (Turn-Historie im Body).

---

## Technische Details

**Frontend:**
- `src/pages/CoachingView.tsx` komplett neu als Story-Reader
- Neuer State-Machine Hook `useCoachingReader` (currentCard, cards[], next(), prev(), completeCard())
- Cards als eigene Komponenten: `CoverCard`, `CustomerCard`, `ChatHistoryCard`, `SituationCard`, `MessageBubbleCard`, `MoneyLossCard`, `BetterAnswerCard`, `DrillCard`, `TypeAnswerCard`, `BossAnecdoteCard`, `TakeawayCard`, `BossFightCard`, `RankingCard`, `CommitmentCard`, `FinalCard`
- Framer Motion für Karten-Übergänge (slide + fade)
- Untere Progress-Bar + XP-Counter oben
- Speicherung `current_card_index` bei jedem `next()`

**Edge Functions:**
- `generate-coaching-analysis`: Schema erweitern (customer_card, context_messages, drill, boss_scenario, boss_anecdote), Prompt anpassen für B1-Sprache und Mimikry
- `evaluate-coaching-simulation`: Multi-Turn Support (turn_history[] im Body, KI antwortet als Kunde ODER bewertet je nach Modus)
- neu `evaluate-coaching-drill`: bewertet freie Tipp-Antworten
- neu `update-coaching-xp`: schreibt XP/Card-Index

**Migration:** 4 neue Spalten auf `coaching_analyses` (`xp_earned`, `current_card_index`, `commitment_text`, `boss_fight_result`).

**Nicht angefasst:** `Coaching.tsx` (Admin-Übersicht bleibt, zeigt neu XP und Fortschritt); PDF-Generierung ist bereits raus.

---

## Umsetzungs-Reihenfolge

1. Migration (4 Spalten)
2. Edge Functions: `generate-coaching-analysis` Schema + Prompt, `evaluate-coaching-simulation` Multi-Turn, neu `evaluate-coaching-drill`, neu `update-coaching-xp`
3. `src/lib/coaching.ts` — Helper für XP, Card-Index, Drill-Evaluation
4. Kartenkomponenten in `src/components/coaching/cards/`
5. `useCoachingReader` Hook
6. `CoachingView.tsx` neu als Story-Reader
7. `Coaching.tsx` Admin: XP/Fortschritt Spalte
