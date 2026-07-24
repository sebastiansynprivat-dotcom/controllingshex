# Coaching v4 — Dopamin, Subtilität, spürbarer Fortschritt

Ziel: Der Chatter geht aus dem Coaching mit dem Gefühl raus „das hat Spaß gemacht, ich hab was gecheckt, ich werde jeden Tag besser". Kein Wort am Tonfall der AI wird angefasst — nur **Layout, Micro-Interactions und Framing** in `CoachingView.tsx` (+ kleiner Zusatz in `coaching.ts` fürs Progress-Modell).

## Die drei Wirkungen — und wie wir sie bauen

### 1) Dopamin & Spaß (Hooked-Loop pro Karte)

Jede Karte bekommt ein **Mikro-Belohnungs-Ereignis** (Trigger → Aktion → variable Reward → Investment) statt nur „Weiter":

- **Reveal-Snap:** Bei jeder aufgedeckten Info (Kontext-Bubble, Verdict, Better-Version, Quiz-Auflösung) ein satter Motion-Snap (spring, subtiler Haptik-Vibrate auf Mobile via `navigator.vibrate?.(8)`), 300-500ms Confetti-Puff nur bei richtigen Antworten / abgeschlossenen Hebeln.
- **Streak-Chip** oben rechts (Ersatz für die entfernte XP-Anzeige): zeigt aktuellen „Richtig-in-Folge"-Zähler mit einer stillen Flame-Skala (1 = grau, 3 = amber, 5+ = rose). Kein Score, keine Zahlen-Angst — nur ein weiches „läuft grad".
- **Sound-optional:** ein einzelner, sehr leiser „tick" beim Bubble-Reveal (mutable Toggle in der Top-Bar, default aus). Kostet nichts, verstärkt bei Aktivierung massiv.
- **Variable Bubble-Delays** (400–1100ms) statt fixem Timing — das Gehirn liest es als „echt".
- **Cinema-Progressbar** wird von linearem Balken auf **Perlenkette** (Dots pro Nachricht) umgestellt — jeder Dot poppt beim Freischalten. Sichtbarer Fortschritt = Dopamin.

### 2) Subtilität — „genau das hat mir gefehlt"

Aktuell steht das Learning oft explizit oben („Hier ist dein Fehler"). Wir drehen das um, sodass der Chatter das Learning **selbst formuliert im Kopf**:

- **Ah-ha-Framing statt Fehler-Framing:**
  - Eyebrow-Texte umbauen: „Was hier passiert ist" statt „Fehler-Analyse". „Die Version, die zündet" statt „Bessere Antwort". „Kurzer Reflex-Check" statt „Mini-Übung".
  - Verdict-Card zeigt zuerst nur den **Kontrast** (deine Bubble vs. bessere Bubble, side-by-side, ohne Bewertungstext). Erst nach 800ms Delay faded eine **einzige Zeile** ein: „Merkst du den Unterschied?" Der KI-Kommentar erscheint erst per Tap auf „Warum eigentlich?".
  - Money-Zeile wird nicht mehr als roter Alarm gerendert, sondern als **beiläufige Fußnote** in Muted-Grau — „so viel liegt in einer besseren Führung drin". Wirkt stärker als Balken.
- **„Du wusstest es fast" Nudges:** Wenn ein A/B-Score >= 5 ist, zeigen wir statt „Falsch" den Text „Fast — du warst nah dran". Konsequente Aufwertung kleiner Wins.
- **Weniger Text pro Karte, mehr Weißraum:** aktuelle Karten haben teilweise 3-4 Absätze; wir cappen auf **1 Kernsatz + 1 optional aufklappbares „Warum"**. Reduziert kognitive Last, macht Learnings „gefühlt eigene".
- **Story-Sprache in Micro-Copy** (nur die Rahmen-Texte, nicht die AI-Analyse):
  - „Szene 1 von 3" statt „Hebel 1"
  - „Du bist dran" statt „Übung"
  - „Nächste Szene" statt „Weiter"

### 3) Motivation & spürbarer Fortschritt (Placebo-Progress)

Der Kern: Der Chatter muss **fühlen**, dass er sich verbessert — auch innerhalb einer einzigen Session und über Sessions hinweg.

- **Momentum-Line** (neue Top-Bar-Komponente, ersetzt XP-Reste): dünner Sparkline-Verlauf der aktuellen Session-Scores (Quiz + Drills + Boss-Fight). Jeder neue Score verlängert die Linie mit sanftem Draw — visuell steigend, weil wir intern immer den **rollierenden Best-of-3** anzeigen (nie Rückschritt sichtbar, außer wirklich krass).
- **„Vor 2 Wochen hättest du…" Callout** vor der ersten Drill-Karte: wenn eine ältere Analyse für den Chatter existiert (`listAnalyses` gibt es bereits), zeigen wir eine kurze, ruhige Zeile „Letztes Mal war [Hebel X] dran — heute geht's einen Schritt weiter." Kein Vergleich mit Zahlen, nur ein sanftes Kontinuitäts-Signal. Fällt weg wenn keine History.
- **End-Screen (`FinalCard`) neu aufgebaut** als **„Was du heute mitgenommen hast"**:
  - 3 kurze Bullets, aus den 3 Hebel-Takeaways destilliert (Text existiert schon in `result.top_3_levers[].takeaway`).
  - Ein einziger großer Satz darüber: „Du hast [N] Szenen durchgespielt. Beim nächsten Mal fällt dir das automatisch auf." — Formulierung suggeriert Kompetenz-Automatisierung.
  - Commitment-Feld ist **prominenter Hero** statt Beiwerk — das eigene Handschriftliche = stärkster Anker.
  - Kleiner „Verlauf"-Link zurück auf `getShareUrl` (Chatter kann jederzeit re-visit → weiterer Progress-Anker).
- **Persistenter Streak über Sessions:** neue Spalte im `progress_json`: `session_streak` (Anzahl abgeschlossener Coachings in Folge, Reset wenn > 21 Tage Lücke). Wird als stiller Chip auf Cover-Karte gezeigt („dein 4. Coaching in Folge"). Keine Public Leaderboards, kein Vergleich mit anderen — nur mit sich selbst.

## Karten-Änderungen konkret


| Karte              | Vorher                                  | Nachher                                                                                            |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `CoverCard`        | Titel + Hebel-Zahl                      | + Streak-Chip („dein 3. Coaching"), + Momentum-Line-Placeholder                                    |
| `LeverIntroCard`   | „Hebel 1 von 3"                         | „Szene 1 von 3" — sonst gleich                                                                     |
| `CinemaCard`       | linearer Balken, expliziter Fehler-Text | Dot-Kette, Reveal-Snap + optional Vibrate, Verdict als Kontrast-Split ohne Text, „Warum?" per Tap  |
| `CinemaBetterCard` | „Bessere Antwort"                       | „Die Version, die zündet" + 300ms Confetti-Puff beim Anzeigen                                      |
| `DrillCard` (A/B)  | „Falsch/Richtig"                        | „Nah dran / Genau der Move" — Score >=5 = grüner Framing                                           |
| `TypeDrillCard`    | Score + Feedback                        | Score als Momentum-Delta („+1 in Führung"), Feedback aufklappbar                                   |
| `QuizCard`         | Direktes Verdict                        | 400ms Delay + Snap, bei richtig → Puff                                                             |
| `BossFightCard`    | Textblock am Ende                       | Score → Momentum-Line-Update, „Was du gut gemacht hast" zuerst, „Was noch besser geht" aufklappbar |
| `FinalCard`        | XP raus, aktuell dünn                   | Hero-Commitment, 3 Takeaway-Bullets, Kontinuitäts-Satz, Re-Visit-Link                              |


## Technisches

```text
CoachingView.tsx
├─ neue Sub-Komponenten
│   ├─ StreakChip           (Top-Bar rechts, ersetzt XP)
│   ├─ MomentumLine         (dünne SVG-Sparkline, rollierendes Best-of-3)
│   ├─ RevealSnap           (Wrapper mit spring + optional vibrate + optional tick)
│   └─ ContrastReveal       (side-by-side Bubbles mit delayed Kommentar)
├─ Copy-Konstanten          (alle „Übung/Fehler/Weiter" Texte an einer Stelle → leicht tunbar)
└─ Sound-Toggle             (localStorage `coaching.sound = on|off`, default off)

coaching.ts
└─ CoachingProgress
    + session_streak?: number
    + momentum_scores?: number[]   (rollierend, max 10 Einträge)
```

- Keine Änderung an AI-Prompt, Edge Functions, DB-Schema (progress_json ist bereits JSONB).
- Keine Änderung an Tonalität / Sprache der AI-Analyse — nur Rahmen-Copy in der View.
- Confetti: leichtgewichtig selbst gebaut mit 8-12 divs + Framer Motion (kein neues Package).
- Vibrate + Sound sind Progressive Enhancement, silent fail auf iOS-Safari.

## Betroffene Dateien

- `src/pages/CoachingView.tsx` — Hauptarbeit (Sub-Komponenten, Copy, Reveal-Snaps, End-Screen-Rebuild).
- `src/lib/coaching.ts` — `CoachingProgress` Interface + `computeProgressStats` optional um Streak/Momentum erweitern.

## Explizit NICHT dabei

- Keine Änderung an der AI-Tonalität, Prompts oder Empathie-Regel.
- Kein neues Backend, keine neuen Edge Functions, keine Migration.
- Keine Rankings/Leaderboards gegen andere Chatter.
- Kein Zurück zu XP-Zahlen.