
# Plan: Coaching-PDF für "nicht super schlaue" Chatter optimieren

Leitprinzip: **Der Chatter soll das PDF einmal lesen und danach im Chat sofort etwas anders tippen können — ohne nachdenken zu müssen.**

Drei Änderungs-Ebenen: (1) was die AI generiert, (2) wie es im PDF layoutet ist, (3) wie die Kernbotschaft wiederholt wird.

---

## 1. Neues Content-Modell aus der AI (`generate-coaching-analysis`)

Aktuell liefert die AI pro Hebel: `principle`, `wrong_example`, `better_example`, `story`, `money_example`, `if_then_script`. Das ist zu viel Prinzip, zu wenig Chat.

**Neu pro Hebel → ein Mini-Storyboard mit 3 Sprechblasen-Runden:**

```text
lever = {
  name: "3 Wörter, max.",                    // z.B. "Erst neugierig machen"
  one_liner: "1 Satz, B1, was ändert sich",  // z.B. "Nicht direkt schicken. Erst ihn heiß machen."
  money_line: "1 Zeile: das bringt Cash",    // Zahl bleibt, wie heute
  storyboard: [
    { round: 1, customer: "…echte Kundenzeile…", chatter_did: "…was er wirklich schrieb…", verdict: "ok | schwach" },
    { round: 2, customer: "…", chatter_did: "…", better_version: "…so hätte es mehr gebracht…", why_one_line: "kurz warum" },
    { round: 3, customer: "…nächste Situation, die im Alltag wiederkommt…", say_this: "…exakt dieser Satz…" }
  ]
}
```

Rekonstruktion aus echten Chat-Digests, nicht erfunden. `better_version` und `say_this` bleiben unter 200 Zeichen, in der Stimme des Chatters (Stil-Mimikry-Regeln bleiben). Keine Preise, keine Coach-Sprache — bestehende Tabus bleiben.

**Digest-Phase erweitern:** pro Chat zusätzlich `key_moment` (die eine Zeile, die kippen sollte) extrahieren, damit der Meta-Pass genug Rohmaterial für die Storyboards hat.

**Sprach-Regel (neu, hart im Prompt):**
- Max. 12 Wörter pro Satz in allen Erklärfeldern.
- Keine Fremdwörter außer PPV, DM, Fan.
- Kein "sozusagen", "grundsätzlich", "im Kern", "Prinzip", "Dynamik", "Framework".
- Wenn ein Satz länger als 12 Wörter wird → in zwei kurze splitten.

## 2. PDF-Layout: Chat-Bubbles statt Fließtext (`src/lib/coaching.ts`)

Neue Zeichnen-Primitive:
- `drawCustomerBubble(text)` — linksbündig, grau, "Kunde" darüber.
- `drawChatterBubble(text, variant)` — rechtsbündig, `variant = "was_du_geschrieben_hast" | "besser_so" | "sag_das"`. Farbcodes:
  - was_du_geschrieben_hast: neutral
  - besser_so: Akzentfarbe + kleines "✓" links
  - sag_das: Akzent stark + "Merke dir diesen Satz" als Mini-Label
- `drawRoundLabel(nr)` — "Runde 1 / Runde 2 / Runde 3".

**Neue Seitenstruktur (weiterhin 6 Seiten):**

```text
Seite 1 — Cover
  Name, Vorperioden-Vergleich (bleibt), 1 großer Satz: "Diese Woche geht es um: <lever[0].name>"
Seite 2 — Hebel 1 (der wichtigste) als Storyboard
Seite 3 — Hebel 2 als Storyboard
Seite 4 — Hebel 3 als Storyboard
Seite 5 — "Deine Stärke diese Woche" (1 Bubble-Beispiel wo er's gut gemacht hat) + "Ein Ding zum Aufpassen"
Seite 6 — Fahrplan: der EINE Satz aus Hebel 1 groß + Mikro-Aktion + Selbstfrage
```

Jede Hebel-Seite:
```text
[Header: HEBEL 1 · Erst neugierig machen]
[one_liner in großer Schrift]
[money_line als kleine Akzent-Zeile]

Runde 1
  🗨 Kunde: "…"
  🗨 Du: "…"                        (neutral)
  ↳ verdict-chip

Runde 2
  🗨 Kunde: "…"
  🗨 Du: "…"                        (neutral)
  🗨 Besser so: "…"                 (Akzent + ✓)
  why_one_line (klein, unter Bubble)

Runde 3 — nächstes Mal
  🗨 Kunde: "…"
  🗨 Sag genau das: "…"             (Akzent stark)
```

Kein Fließtext-Absatz mehr auf Hebel-Seiten. Bubble-Layout mit fester Bubble-Breite (ca. 70% Contentbreite), auto-wrap, Emoji-safe (bestehende `drawRichLine` weiterverwenden).

Layout-Validator bleibt an — die neuen Bubble-Zeichner müssen Höhen sauber zurückgeben, damit Overflow-Retries wie bisher funktionieren.

## 3. Wiederholung: die 3x-Regel für den Kern-Hebel

`lever[0]` (höchster Impact) taucht in drei unterschiedlichen Formen auf:

1. **Cover (Seite 1):** als Überschrift-Satz "Diese Woche geht es um: <lever[0].name>."
2. **Hebel-Seite 1 (Seite 2):** volles Storyboard.
3. **Fahrplan (Seite 6):** der `say_this`-Satz aus Runde 3 nochmal groß + als Mikro-Aktion formuliert.

Hebel 2 und 3 stehen nur je einmal — bewusst weniger Gewicht, damit die Kernbotschaft nicht verwässert.

## 4. Kleinere Aufräum-Punkte im gleichen Turn

- Alte Felder `principle`, `story`, `if_then_script`, `alternative_if_then` aus Schema und Renderer entfernen (werden durch Storyboard ersetzt).
- Fallback-Rendering für alte Analysen: falls ein alter Datensatz noch ohne `storyboard` kommt, weiter mit dem bisherigen Renderer laufen lassen (Weiche in `src/lib/coaching.ts`).
- Automatischer Retry-Loop (bis 3x) bleibt unverändert.
- Kosten: die neuen Storyboards machen den Meta-Prompt eher kürzer, nicht länger — bleibt bei `gemini-3.1-pro-preview`.

---

## Technische Änderungen (kompakt)

- `supabase/functions/generate-coaching-analysis/index.ts`
  - Digest-Schema: `+ key_moment`
  - Meta-Schema: `top_3_levers[].storyboard[]`, entfernt: `principle`, `story`, `if_then_script`, `alternative_if_then`
  - Neuer harter Sprach-Block (12-Wörter-Regel, verbotene Wörter)
- `src/lib/coaching.ts`
  - Neue Renderer: `drawCustomerBubble`, `drawChatterBubble`, `drawRoundLabel`, `drawLeverStoryboardPage`
  - Cover: großer "Diese Woche geht es um"-Satz
  - Fahrplan: nutzt `lever[0].storyboard[2].say_this`
  - Alt-Fallback-Weiche
- Keine DB-Änderungen. Keine neuen Secrets.

## Was nicht geändert wird

- Vorperioden-Vergleich auf dem Cover.
- Layout-Validator + Auto-Retry.
- Bot-DM-Regel, Preis-Tabu, Singular-Ansprache, Stil-Mimikry, Kontext-Pflicht — alles bleibt und wird zusätzlich mit den neuen Storyboards verwoben.
- Modell (`gemini-3.1-pro-preview` für Meta, Flash für Digests).
