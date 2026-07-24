# Coaching-Verlauf: "Cinema-Mode" mit Pflicht-Play & Guess-Stops

## Ziel
Chatter sollen sich den echten Chatverlauf zu 100% durchlesen — psychologisch smart, ohne dass es sich wie Zwang anfühlt. Mix aus **Netflix-Sog** (Auto-Play, Cliffhanger) und **Hebel-Wirkung** (Guess-First, dann Reveal).

## Kernidee in einem Satz
Statt "Kompletten Verlauf ansehen"-Button wird der Verlauf zur **Pflicht-Karte** in der Story-Sequenz: Nachrichten spielen sich einzeln ab wie ein Chat live vor deinen Augen, stoppen an DEINER Antwort, du rätst was du geschickt hast — dann Reveal.

## Wie der Chatter das erlebt

```text
┌─────────────────────────────────┐
│  🎬 So lief euer Chat wirklich  │
│  Nachricht 4 von 9              │
│  ▓▓▓▓▓▓░░░░░░░░░               │
├─────────────────────────────────┤
│                                 │
│  Kunde                          │
│  ┌──────────────────┐           │
│  │ hey, geht's dir  │           │
│  │ noch gut heute?  │           │
│  └──────────────────┘           │
│                                 │
│              (Kunde tippt...)   │
│              ┌───┐              │
│              │•••│              │
│              └───┘              │
│                                 │
│  Kunde                          │
│  ┌──────────────────┐           │
│  │ hab an dich      │  ← neu    │
│  │ gedacht 😏       │           │
│  └──────────────────┘           │
│                                 │
│         [Pause] Antippen für    │
│              nächste Nachricht  │
└─────────────────────────────────┘
```

An der kritischen Stelle (deine Antwort):

```text
┌─────────────────────────────────┐
│  ⏸  STOP — dein Moment          │
│                                 │
│  Der Kunde hat das gerade       │
│  geschrieben ↑                  │
│                                 │
│  Was hättest DU jetzt           │
│  geantwortet?                   │
│                                 │
│  ┌───────────────────────────┐  │
│  │ Tipp deine Antwort...     │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│  [ Antwort abschicken ]         │
│                                 │
│  oder                           │
│  [ Skip — nur zeigen ]          │
└─────────────────────────────────┘
```

Nach Abschicken:

```text
┌─────────────────────────────────┐
│  Du hast geschrieben:           │
│  "hey ja mir geht's gut..."     │
│                                 │
│  ─────────────────────          │
│                                 │
│  Was du WIRKLICH geschickt hast:│
│  ┌──────────────────┐           │
│  │ ja alles gut bei │           │
│  │ dir 🙂           │           │
│  └──────────────────┘           │
│                                 │
│  🤖 KI-Verdict: 4/10            │
│  Du hast den heißen Ball        │
│  ("hab an dich gedacht")        │
│  komplett fallen gelassen.      │
│                                 │
│  💰 Geschätzter Verlust: ~35€   │
└─────────────────────────────────┘
```

## Psychologische Hebel (bewusst eingebaut)

1. **Cliffhanger-Loop:** Jede Kundennachricht endet mit "Und was passierte dann?" — Neugier zwingt zum Weitertappen.
2. **Guess-First (Endowment-Effekt):** Sobald der Chatter seine eigene Version tippt, WILL er wissen, ob er richtig lag. Das eigene Investment macht den Reveal unwiderstehlich.
3. **Zeigarnik-Effekt:** Fortschrittsbalken "4 von 9" macht Abbruch mental unmöglich (halb-fertige Aufgaben nerven das Gehirn).
4. **Hartes Gate:** "Weiter" zur nächsten Karte ist **deaktiviert**, bis alle Nachrichten der Runde freigetappt wurden. Kein Skip.
5. **Money-Anchor:** Nach jedem Reveal ein €-Verlust-Wert ("Diese Antwort hat dich ~35€ gekostet") — konkreter Schmerz > abstraktes Feedback.
6. **Micro-Rewards:** +2 XP pro getappter Nachricht, +25 für gutes Guess, sichtbar als kleine Pings am Rand.
7. **Social Proof am Anfang der Karte:** "Nur 12% der Chatter lesen den ganzen Verlauf — sei einer davon" (statischer Text, keine Live-Zahl nötig).
8. **Realistische Typing-Delays:** 400ms-1200ms Pausen + "Kunde tippt…" Indicator = fühlt sich an wie live Zuschauen, nicht wie Lernen.

## Architektur

### Ersetzt / ändert sich
- **`FullChatHistory` (aktueller Collapse-Button)** → wird komplett entfernt.
- **`ChatterDidCard`** → wird zur neuen **`CinemaCard`** (Auto-Play + Stops + Reveal in einem).
- Bisherige `context` + `chatter_did` + `verdict` + `money_line` Karten werden in die CinemaCard fusioniert. Das reduziert die Anzahl Karten pro Hebel, macht den Flow filmischer und der Chatter kriegt Kontext + Fehler + Kosten in einem geführten Erlebnis.

### Neue Karten-Kinds (in `CoachingView.tsx`)
- `cinema` — die Pflicht-Karte mit Auto-Play + Stop + Guess.
- `cinema_better` — direkt danach: gleicher Verlauf, aber die "bessere" Antwort spielt sich als Bubble ein. Kein Guess mehr, nur "So sieht's richtig aus."

### Cards-Sequenz pro Hebel (neu)
```text
lever_intro
  → customer_card
  → cinema          (NEU: Verlauf + Guess + Real + Verdict + €-Verlust)
  → cinema_better   (NEU: gleicher Verlauf, letzter Bubble = better_version)
  → drill (A/B)
  → type_drill
  → boss_anecdote
  → takeaway
  → quiz
```

### Gate-Logik
- Auf `cinema`-Karte ist `onAdvance` (Weiter-Button) **disabled**, bis:
  - alle `context_messages` freigetappt wurden UND
  - Guess abgeschickt (oder explizit "Skip — nur zeigen" gedrückt, gibt weniger XP) UND
  - Reveal + Verdict gesehen.
- Bottom-Nav-Weiter-Button muss den `canAdvance` State aus der aktiven Karte lesen. Dazu die bestehende `onAdvance`-Prop-Struktur um ein `canAdvance` erweitern (State im Parent, Karte meldet über neuen Callback `onGateStatus`).

### State pro Cinema-Karte (in `progress_json`)
- `cinema_progress: Record<leverIndex, { messages_revealed: number; guess?: string; guess_score?: number; completed: boolean }>`
- Wird über `updateProgress` persistiert wie alle anderen Progress-Felder.

### Guess-Bewertung
- Nutzt die bereits existierende `evaluateDrill` Edge Function (oder `evaluateSimulation` mit `mode: evaluate_single`) — kein neuer Backend-Endpoint nötig. Der Prompt bekommt Kontext + echte Antwort + Guess und liefert Score + kurzes Feedback.

### Money-Verlust anzeigen
- Nutzt das existierende `lever.money_line` (bereits vom AI-Prompt geliefert). Kein Schema-Change nötig.

## Technisches (kurz)

- Auto-Play: `setTimeout`-Kette mit variablen Delays (500-1200ms), Typing-Dots als Zwischenschritt vor jeder Kunden-Bubble.
- Tap-to-advance-Fallback: Wenn Chatter tappt, springt sofort zur nächsten Bubble (überspringt Delay).
- Framer Motion für Bubble-Einblendung: `initial={{ opacity: 0, y: 8 }}, animate={{ opacity: 1, y: 0 }}`.
- Alle neuen Farben/Styles über bestehende semantic tokens + amber/rose/emerald wie im Rest der View (bereits etabliert).
- Kein neues Backend-Schema, keine neue Edge Function, keine DB-Migration.

## Betroffene Dateien
- `src/pages/CoachingView.tsx` — neue `CinemaCard` + `CinemaBetterCard`, alte `ChatterDidCard`/`MoneyLossCard`/`BetterCard`/`FullChatHistory`/`ContextCard` entfernen bzw. konsolidieren, `cards`-Sequenz-Builder anpassen, Gate-State ins Parent-Component ziehen.
- `src/lib/coaching.ts` — `CoachingProgress` Interface um `cinema_progress` erweitern.

## Was NICHT dazugehört
- Keine Änderung an AI-Prompt / JSON-Schema (bestehende Felder reichen).
- Keine neuen DB-Spalten.
- Keine Änderung an Boss-Fight, Quiz, Drill, Commitment.
- Kein Rework der Cover/Weekly/Final-Karten.
