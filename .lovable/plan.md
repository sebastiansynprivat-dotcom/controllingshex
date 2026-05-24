## Was sich ändert

Der aktuelle Prompt zieht zu stark in eine Richtung: Boss spricht zu Team, fast jeder Post hat einen Job-Bezug (online kommen, Pitches, Workflow). Das wirkt mit der Zeit eindimensional. Du willst, dass auch mal Posts dabei sind, die mit dem Job NICHTS zu tun haben — pure Mindset/Gedanken, mal länger ausgeführt, mal aus dem Leben, mal philosophisch. Das kommt erfahrungsgemäß am besten an.

## Konkrete Prompt-Anpassungen in `generate-channel-plan/index.ts`

### 1. Rolle erweitern (nicht nur Boss)
Aktuell: „Founder/Teamleiter, der morgens im Team-Chat schreibt."
Neu: zusätzlich „Mensch, der mit seinem inner circle teilt was ihn gerade beschäftigt — manchmal Teamleiter, manchmal einfach jemand der laut denkt."
→ Die Boss-Energie bleibt erlaubt, aber ist nicht mehr Default für jeden Post.

### 2. Neuer Theme-Mix mit deutlich mehr Mindset & Variabilität
Aktuelle Verteilung ist zu Job-lastig. Neu:

- PUSH ~25 % (vorher 40)
- MINDSET ~30 % (vorher 25) — explizit aufgeteilt:
  - „Mindset-Job" (Gedanke zum Arbeiten, Geld, Disziplin)
  - „Mindset-Life" (Beobachtung über Menschen, Beziehungen, Energie, Wachstum — KEIN Job-Bezug)
- DEEP ~10 % (NEU): längerer Post (5–8 Sätze), ausgeführter Gedanke, kleine Story / Erkenntnis aus dem Alltag. Darf komplett losgelöst vom Job sein.
- APPRECIATION ~10 %
- TACTICAL ~10 %
- VIBE ~10 %
- MONEY überlagert PUSH an Tag 1–5 (wie gehabt)

→ Pro Woche soll mindestens 1 DEEP-Post + mindestens 1 MINDSET-Life-Post drin sein. Wird im Prompt als harte Vorgabe geschrieben.

### 3. Längen-Variabilität schärfer vorgeben
Aktuell nur „kurz vs. länger". Neu drei klare Modi, die über die Woche verteilt werden müssen:
- SHORT: 1–2 Sätze (Hammer, Vibe, knapper Push)
- MEDIUM: 3–4 Sätze (Standard)
- LONG: 5–8 Sätze (DEEP/ausgeführter Mindset-Post — mit Pausen, Gedankenstrichen, kleinem Bogen)

Im Prompt explizit: „mindestens 1 LONG-Post pro Woche, mindestens 2 SHORT-Posts, Rest MEDIUM. Keine zwei LONG-Posts hintereinander."

### 4. Inhaltliche Räume für Mindset-Life-Posts
Neue Sektion im Prompt mit Beispielen für Themenräume, aus denen MINDSET-Life und DEEP ziehen dürfen:
- Beobachtungen über Menschen (warum die meisten nie raus aus ihrem Loop kommen)
- Energie, Umfeld, mit wem man sich umgibt
- Geld-Mindset (nicht „verdient mehr", sondern Haltung zu Geld)
- Disziplin vs. Motivation
- Wachstum, Unbequemlichkeit
- kleine Alltagsgeschichten mit Erkenntnis
- Lesen, Sport, Schlaf, Routine — aber als Gedanke, nicht als Ratschlag
- Was Erfolg wirklich kostet

Hinweis im Prompt: „diese Posts klingen NICHT wie Coaching/Instagram-Zitat — sondern wie jemand, der laut denkt. Persönlich, mit Ich-Form erlaubt, mit Zweifel/Ehrlichkeit erlaubt."

### 5. Mehr Variations-Achsen im Prompt
Erweitere Variations-Regeln um:
- Perspektivwechsel: nicht jeder Post in Du-Form. „Ich"-Posts (eigener Gedanke), „Wir"-Posts (Team), „Du"-Posts (direkter Push) mischen.
- Energie-Level variieren: ruhig/nachdenklich vs. laut/pushig
- Einstieg variieren: mal direkt mit Beobachtung, mal mit Frage, mal mit Szene („gestern im Auto…"), mal mit harter Aussage

### 6. Tool-Schema erweitern
`theme`-Enum bekommt neue Tags: `PUSH | MINDSET-JOB | MINDSET-LIFE | DEEP | APPRECIATION | TACTICAL | VIBE | MONEY`.
Neues optionales Feld `length`: `"short" | "medium" | "long"` — zwingt die AI bewusst über die Länge zu entscheiden und gibt dir später eine Anzeige-Möglichkeit.

### 7. Anti-AI-Schutz für die neuen Mindset-Posts
Verbotene Phrasen ergänzen, damit MINDSET-Life nicht ins Instagram-Coaching kippt:
- „Lebe deinen Traum", „Sei die beste Version", „Komfortzone verlassen", „Reicher Mindset", „Es liegt an dir", „Hör auf dein Herz", „Vertrau dem Prozess", „Mindset is everything".

## Technisch
- Nur `supabase/functions/generate-channel-plan/index.ts`
- `systemPrompt`: Rolle erweitern, neuer Themen-Mix mit DEEP + MINDSET-Split, Längen-Regel, Themenräume für Life-Mindset, erweiterte Variations-Regeln, erweiterte Floskel-Liste, Perspektivwechsel
- `userPrompt`: Hinweis auf neue Tags und Längen-Pflicht
- Tool-Schema: `theme` Beschreibung aktualisieren, neues Feld `length` mit Enum
- DB-Insert: `theme` bleibt String wie bisher, `length` wandert in `context_notes` (kein Schema-Change nötig)
- Keine UI-Änderung — `ChannelPlanView` zeigt `theme` weiter wie gehabt

## Memory-Update danach
`mem://features/channel-audience.md` ergänzen: Theme-Mix neu (mit DEEP + MINDSET-Life), Pflicht zu mindestens 1 LONG/Woche, Perspektivwechsel erlaubt.

## Ergebnis
Wochenplan wirkt menschlicher: Boss-Pushes, taktische Reminder, Team-Dank — aber auch echte Gedanken, mal ein längerer Post über etwas was nichts mit dem Job zu tun hat. Weniger Wiederholung, mehr „dein Stil".
