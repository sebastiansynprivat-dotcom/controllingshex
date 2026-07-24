# Coaching-Präsentation v4 — Psychologische Verdichtung

Fokus: **wie** dem Chatter das Coaching präsentiert wird. Keine Änderung an der KI-Analyse, Bewertungslogik oder DB-Struktur (bis auf ein neues Progress-Feld). Nur `src/pages/CoachingView.tsx` + kleine Ergänzungen in `src/lib/coaching.ts`.

## Leitidee
Der Chatter soll fühlen: *"Das ist über MICH, das ist heiß, das darf ich nicht verpassen."* Wir bauen die bekannten Hebel aus Behavioral Psychology, Interrogation-Rapport-Playbooks (Reid/HIG), Cialdini, Milton-Erickson-Sprachmuster und Netflix/TikTok-Retention konsequent in die UI-Ebene.

## 1. Personal Cold-Open (statt neutraler Intro-Karte)
- Erste Karte spricht den Chatter beim Vornamen an, nennt exakte Zahl analysierter Chats + Zeitraum, und wirft **einen** brutal konkreten Satz auf den Screen: *"Jeanette — in 28 Chats hast du 3 Whales angefasst. Zwei davon habe ich verbluten sehen."*
- Full-bleed dunkler Hintergrund, ein Satz, kein Chrome. Erst nach 1.2 s erscheint der "Weiter"-Hinweis (Delay = Gewicht).
- Quelle: **Pattern-Interrupt** + **Named-Address** (Erickson) + **Loss-Framing** (Kahneman).

## 2. Progress-HUD wie ein Game, nicht wie ein Kurs
- Oben permanent sichtbar: dünner Fortschrittsbalken + Karten-Zähler ("3 / 17") + kleiner Puls-Dot rechts.
- Bei jeder abgeschlossenen Karte: dezenter Haptik-artiger UI-Puls (scale 1 → 1.04 → 1) + Balken schiebt hörbar (sanftes Framer-Ease).
- Level bleibt, XP bleibt raus (bestehende Entscheidung).
- Quelle: **Zeigarnik** + **Endowed-Progress-Effekt**.

## 3. Tonalität: Boss-Voice statt Coach-Voice
- Alle statischen UI-Texte (Eyebrows, Buttons, Empty-States, Gate-Hinweise) auf einen einheitlichen Stil bringen: kurz, direkt, "Du", leicht rau, kein Trainer-Sprech.
- Beispiele:
  - "Mini-Übung · Welche ist besser?" → "Zwei Antworten. Eine bringt Geld. Welche?"
  - "Weiter" → "Weiter" bleibt, aber gated-Text ändert sich: *"Erst zu Ende schauen. Ich will nicht, dass du das überspringst."* (First-Person vom "Boss").
  - Reveal-Header: "Was du wirklich geschrieben hast:" → "Deine echte Antwort — ungeschönt:"
- Quelle: **In-Group-Signaling** + **Authority** (Cialdini).

## 4. Cinema-Karte psychologisch nachschärfen
Bestehende Cinema-Card bleibt, aber Präsentation:
- Vor Playback ein 2-Sekunden-Split-Screen: links Kunde-Avatar, rechts Chatter-Name, dazwischen ein Zeitstempel. Wirkt wie Boxkampf-Ankündigung.
- Während Playback zufällige Typing-Delays 400-1400 ms (bereits da) + gelegentlich "Kunde tippt…" verschwindet und kommt wieder → simuliert Zögern, erhöht Sog.
- Reveal der echten Chatter-Antwort mit leichtem Delay + roter Kontur-Blink 1×, dann Verdict-Zeile.
- €-Verlust-Zahl in großer, präziser Ziffer (nie gerundet auf 10er, nutzt genau die vom Prompt gelieferte Range).
- Quelle: **Anticipation-Framing** (Netflix Cold-Opens), **Precision-Bias** (präzise Zahlen wirken glaubwürdiger).

## 5. Better-Version-Karte als "Zeitmaschine"
- Header: "Spul zurück. So hätte es laufen können."
- Gleiche Chat-Szene, aber der letzte Bubble ist die bessere Antwort — mit einem grünen €-Betrag daneben ("+120–180€ Fan-Lifetime").
- Ein Satz drunter, sehr klein: *"Merk dir diese eine Zeile. Sie ist der Unterschied."*
- Quelle: **Counterfactual-Simulation** (Roese) — Menschen lernen aus "was wäre wenn" stärker als aus "was war".

## 6. Mini-Übung (Drill) als Split-Test-Optik
- A/B nebeneinander in zwei Karten-Slots, nicht untereinander.
- Nach Wahl: die falsche Option wird ausgegraut + durchgestrichen, die richtige bleibt farbig und bekommt eine kurze "Warum"-Zeile.
- Bei falscher Wahl: **kein** rotes Kreuz, sondern trockener Text: *"Nicht falsch. Nur teurer."* + der €-Range der besseren Option.
- Quelle: **Face-Saving-Feedback** (HIG Rapport-Playbook) — Härte ohne Demütigung.

## 7. Type-Drill mit Live-Mirror
- Während der Chatter tippt, erscheint über dem Textfeld in grau *"Der Boss liest mit…"* — verschwindet on-focus-out.
- Nach Submit: die polierte Version wird **zusammen** mit der eigenen gezeigt, Diff-Markierung (Wörter, die entfernt/ersetzt wurden, sind unterstrichen).
- Quelle: **Observer-Effect** (leichter sozialer Druck) + **Direct-Comparison-Learning**.

## 8. Boss-Anekdote als Chatblase vom "Boss"
- Kein Karten-Header "Anekdote", sondern eine Nachricht-Bubble mit Boss-Avatar + Uhrzeit, so als würde der Boss dem Chatter privat schreiben.
- Text zweiteilig: Hook (fett, ein Satz) → Story (2–3 Sätze) → kurze Signatur.
- Quelle: **Social-Proof-Narrative** + **In-Group-Storytelling** — In-Character-Präsentation erhöht Encoding.

## 9. Quiz als Konsequenz, nicht als Test
- Header: nicht "Quiz", sondern "Kurz-Check — sitzt es?"
- Bei richtig: eine Zeile Bestätigung + Micro-Line *"Genau so denkt ein Closer."*
- Bei falsch: keine Punktabwertung sichtbar, stattdessen: *"Lies die Karte davor nochmal. Ich warte."* mit Scroll-Back-Button zur letzten Karte.
- Quelle: **Reciprocity** (Boss "wartet auf dich") + **Autonomy-Support** (Deci/Ryan) — freundlicher Zwang.

## 10. Commitment-Karte am Ende — echter Vertrag
- Zeigt oben den vollen Namen des Chatters, Datum, Modell-Range.
- Textfeld heißt: *"Was machst du diese Woche anders? Ein Satz. Schreib ihn so, dass du ihn dir selbst glaubst."*
- Submit-Button: "Ich commit-te mich" (deutscher Denglisch-Boss-Ton).
- Nach Submit: der Satz wird als handgeschriebenes "Unterschrift"-Element gerendert (script-artige Font, bereits verfügbare Serif oder eine leichte Rotation).
- Quelle: **Cialdini Commitment/Consistency** — schriftlich > mündlich, öffentlich > privat, personalisiert > generisch.

## 11. Micro-Momente über die ganze View
- **Sticky Boss-Line**: Am unteren Screen-Rand permanent eine dünne Zeile mit der aktuellen `micro_action` (max 60 Zeichen), leicht transparent — konstante Erinnerung ohne Modal.
- **Karten-Übergänge**: horizontales Slide + minimaler Blur beim Wechsel (bereits Framer da), gibt kinematisches Gefühl.
- **Loading-States**: Statt Spinner: der Satz *"Boss denkt nach…"* mit Punkte-Animation.
- **Fehler-States**: statt "Error" → *"Kurz verloren, nochmal antippen."*

## 12. Gate-Verhalten diplomatischer, aber härter
- "Weiter" gated bleibt, aber Tooltip wird persönlich: *"Nicht vor mir wegdrehen. Zu Ende sehen."*
- Nach 8 s Inaktivität auf gated Karten: kleines Wobble der "Weiter"-Zone + Hinweis was noch fehlt (z. B. "Noch 3 Nachrichten offen").
- Quelle: **Loss-Aversion** über Attention-Reminder.

## Technische Umsetzung

**Dateien**
- `src/pages/CoachingView.tsx` — alle Präsentations-Änderungen: Personal-Intro-Karte, HUD-Refresh, überarbeitete Header/Buttons/Empty-States, Cinema/Better/Drill/Type-Drill/Anekdote/Quiz/Commitment-Präsentation, Sticky Boss-Line, gated-Tooltip + Wobble.
- `src/lib/coaching.ts` — `CoachingProgress` optional um `sticky_dismissed?: boolean` und `intro_seen?: boolean` erweitern, damit die Cold-Open-Karte nach Erst-Ansicht nicht mehr modal wirkt und die Sticky-Line dismiss-bar bleibt.

**Was NICHT angefasst wird**
- Keine Edge-Function-Änderung.
- Kein Prompt-Change (Analyse liefert bereits alle nötigen Felder: `personal_intro`, `money_line`, `boss_anecdote`, `micro_action`, `context_messages`, `better_version` etc.).
- Kein neues DB-Schema, keine Migration.
- Keine Änderung an Boss-Fight-Mechanik (nur Kopien/Header dort werden auf Boss-Voice angeglichen).

**Reihenfolge im Build**
1. Text-Layer (alle Header/Buttons/Empty-States/Tooltips auf Boss-Voice + Neuformulierungen) — schnell, sofort spürbar.
2. Personal Cold-Open + Progress-HUD-Refresh.
3. Cinema/Better/Drill/Type-Drill/Anekdote/Quiz-Präsentation.
4. Commitment-Vertrag-Optik.
5. Sticky Boss-Line + Gate-Wobble.
6. Micro-Animations & Loading/Error-Copy.

**Verifikation**
- Nach Build: Playwright-Run gegen `/c/:token` mit einem existierenden Analyse-Token, Screenshots pro Karten-Typ, visuelle Prüfung dass Text-Ton konsistent ist und keine Karte "leer" wirkt.
