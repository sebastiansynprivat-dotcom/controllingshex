# Coaching-PDF Redesign: Kürzer, motivierender, umsetzbarer

Basis: Research (Cognitive Load, SDT, Fogg, SBI, Progress Principle, Growth Mindset, Implementation Intentions).

## Kernprinzipien
- **Max 3–4 neue Konzepte** pro PDF (Arbeitsgedächtnis).
- **Ein Hebel = eine Seite** — keine Wiederholung, kein Chat-für-Chat-Protokoll.
- **Worked Examples**: "Falsch → Besser" statt abstrakter Regeln.
- **Wenn-Dann-Skripte** statt Motivationsfloskeln.
- **SBI-Feedback** (Situation-Behavior-Impact), kein Sandwich, Growth-Mindset-Framing.
- **1 Mikro-Aktion** für die nächste Woche, nicht 10.

## Neue PDF-Struktur (6 Seiten)

```text
S.1  Cover + EIN Versprechen + 1 persönliche Kennzahl
S.2  Die 3 Kernhebel — je Icon, 1 Satz, Falsch|Besser Mini-Beispiel
S.3  Hebel 1 vertieft: Wenn-Dann-Skript + 1 Beispiel + Retrieval-Frage
S.4  Hebel 2 + Hebel 3 (je halbe Seite, gleiches Muster)
S.5  Persönliches Feedback (SBI): 1 Stärke ausbauen + 1 Wachstumsfeld
S.6  Action Plan: 1 Mikro-Aktion/Woche + Checkbox-Tracker + Reflexionsplatz
```

## Was RAUS fliegt
- Chat-für-Chat-Analyse jeder Nachricht
- Mehrfach-Do's/Don'ts-Listen (Redundanz)
- Lange Theorie-Blöcke ohne Beispiel
- Generische Motivationsfloskeln
- Wiederholende Zusammenfassungen
- Zahlen-Dashboard mit 8 Metriken → nur 1–2 relevante KPIs

## AI-Schema (Edge Function `generate-coaching-analysis`)

Neuer, radikal reduzierter Output:
```ts
{
  personal_intro: string,           // 2 Sätze, warm, mit 1 echter Kennzahl
  headline_promise: string,          // 1 Satz Cover-Versprechen
  top_3_levers: [{                   // GENAU 3, nicht mehr
    icon_hint: string,               // z.B. "connection", "close", "timing"
    title: string,                   // 3-5 Wörter
    principle: string,               // 1 Satz Warum
    wrong_example: string,           // 1 kurzes Zitat aus echten Chats
    better_example: string,          // Worked Example
    if_then_script: string           // "Wenn X → sage Y"
  }],
  sbi_feedback: {
    strength: { situation, behavior, impact },   // 1 Stärke
    growth:   { situation, behavior, impact, alternative_if_then }  // 1 Wachstumsfeld
  },
  micro_action: string,              // 1 konkrete Handlung für 7 Tage
  retrieval_question: string         // "Was würdest du in dieser Situation sagen?"
}
```

Prompt-Regeln: Deutsch, per "Du", keine Fachbegriffe (oder sofort in Klammern erklärt), keine Emojis in Prosa, Sales-Kontext berücksichtigen (erfolgreicher Sale = Stärke).

## PDF-Renderer (`src/lib/coaching.ts`)

Komplett neuer Layout-Flow:
- Cover: Titel, Headline-Versprechen, 1 persönliche Kennzahl, kleine Score-Anzeige (dezent, kein Dashboard)
- 3-Hebel-Seite: Icon-Karten in Grid (Falsch | Besser)
- Hebel-Detailseiten: Wenn-Dann-Skript als hervorgehobener Block, Retrieval-Frage als Callout
- Feedback-Seite: 2 SBI-Karten (Grün=Stärke, Gold=Wachstum) mit klarer Situation→Verhalten→Wirkung-Struktur
- Action-Seite: Große Mikro-Aktion + 7-Tage-Checkbox-Leiste + leerer Reflexions-Rahmen

Beibehalten: Noto-Font-Pipeline, Black/Gold, SheX-Branding, Emoji-Support wenn stabil.
Entfernt: Zahlen-Dashboard-Seite, "Fahrplan"-Nummerierung, redundante Muster-Sektion, Score-Chart pro Chat.

## Technische Details
- Datei 1: `supabase/functions/generate-coaching-analysis/index.ts` — Prompt + Schema komplett ersetzen, `ChatAnalysis`-Typ verschlanken
- Datei 2: `src/lib/coaching.ts` — `renderAnalysisPDF` neu; alte Sektions-Renderer (dashboard, patterns, chat-cards, fahrplan) entfernen; neue Renderer: `renderCover`, `renderThreeLevers`, `renderLeverDetail`, `renderSBIFeedback`, `renderActionPlan`
- Datei 3: `src/pages/Coaching.tsx` — nur ggf. Progress-Labels anpassen (Struktur bleibt)
- Deploy Edge Function

## Ergebnis
Von 15+ Seiten mit Wiederholungen auf **6 fokussierte Seiten**, die Chatter tatsächlich zu Ende lesen, verstehen und umsetzen — mit einer Mikro-Aktion pro Woche statt Info-Overload.
