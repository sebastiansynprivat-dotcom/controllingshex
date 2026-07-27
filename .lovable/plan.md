## Ziel

Die AI soll deine Handlungen im Hintergrund mitbekommen — ohne dass du ihr etwas sagst — und danach bewerten: „Der Tausch war gut / war schlecht, schau nochmal rein."

## Was bereits existiert (geprüft)

- `swap_decisions` — nur explizit im Wechsel-Mode bestätigte Swaps
- `swap-tracking.ts` — misst Ø-Umsatz 3 Tage vor/nach Swap
- `action_outcomes` — misst Erfolg von im Heute-Tab abgehakten Aufgaben (24/48/72h)

Lücke: Handlungen, die du **außerhalb der App** machst (Account wegnehmen, Chatter tauschen, Chatter rausnehmen, neuen Chatter draufsetzen) werden nirgends erfasst. Genau die sollen jetzt automatisch erkannt werden.

## Konzept: Change-Detection aus Reports

Jeder Upload liefert die aktuelle Chatter×Account-Zuordnung. Vergleich mit dem vorherigen Report ergibt automatisch alle Handlungen:

```text
Report gestern          Report heute            → erkanntes Event
Lara → xbabymarie       Lara → (weg)            → account_removed
                        Maurice → xbabymarie    → account_reassigned (Paar = swap)
Heiko → acc_a           (Heiko fehlt komplett)  → chatter_offboarded
(neu)                   Nina → acc_b            → chatter_onboarded
```

### 1. Neue Tabelle `action_events`
`user_id, platform, event_type, chatter_name, counterpart_chatter, account, prev_account, detected_at, report_id, baseline_json, evaluated_at, verdict, verdict_reason, impact_eur, status`

Events werden pro Report-Upload einmal geschrieben (idempotent über report_id + event-key).

### 2. Erkennung — Edge Function `detect-action-events`
Läuft automatisch direkt nach dem Report-Upload (gleicher Trigger wie der Fahrplan). Vergleicht letzten vs. vorletzten Report, erzeugt Events, und snapshottet die Baseline: Ø Umsatz/Tag der letzten 7 Tage pro betroffenem Chatter und pro betroffenem Account, plus Verzug/Unread aus `chatter_history_live`.

### 3. Bewertung — Edge Function `evaluate-action-events`
Läuft täglich (Cron) plus nach jedem Upload. Für Events, die 3 bzw. 7 Tage alt sind:

- Account-Performance vorher vs. nachher (Account-zentriert, nicht nur Chatter-zentriert — ein Account, der nach dem Wechsel einbricht, ist das eigentliche Signal)
- Chatter-Performance vorher vs. nachher, beide Seiten eines Tausches
- Tier-Kontext (`account-tiers.ts`): kleiner Chatter auf großem Account = Warnung
- Verzug/Unread nach der Handlung: Account liegt jetzt brach → harter Negativ-Verdict

Verdict: `good` / `neutral` / `bad` / `watch` mit Klartext-Begründung und €-Impact, formuliert von Lovable AI (`google/gemini-3.6-flash`) aus den Zahlen — kein reines Regelwerk, damit die Empfehlung auch sagt, was stattdessen zu tun ist.

### 4. Wo du das siehst

- **Neuer angepinnter Eintrag „Rückblick" in der AI-Sidebar**, direkt unter „Fahrplan · heute". Zeigt offene Verdicts als Karten: was du getan hast, was daraus wurde, Empfehlung, plus „Rückgängig prüfen" / „Passt so" / „Im Chat besprechen".
- **Badge mit Anzahl negativer Verdicts** am Rückblick-Eintrag, damit du es ohne Klick siehst.
- **Fahrplan**: negative Verdicts fließen als eigene Actions mit €-Impact in die Tagesliste ein, nach Impact einsortiert wie alles andere.
- **AI-Chat**: neues Tool `get_action_history`, damit du fragen kannst „was habe ich diese Woche getauscht und wie lief es".

### 5. Lernen über Zeit

Verdicts werden aggregiert: „Tausch von Top-Account auf Chatter mit <X Tagen Aktivität ging in 4 von 5 Fällen schief." Dieses Muster geht als Kontext in Fahrplan-Generierung und Swap-Vorschläge, damit die AI dieselbe schlechte Empfehlung nicht wiederholt.

## Technische Details

- Tabelle mit RLS auf `auth.uid()`, GRANTs für `authenticated` + `service_role`
- Erkennung liest `analysis_reports.result_json` der letzten beiden Reports pro Platform, plus `chatter_history` für Baselines, alles über `fetchAllPaged` — keine Limits
- Alles platform-isoliert, konsistent mit der bestehenden Workspace-Trennung der AI
- Neue Dateien: `src/lib/action-events.ts`, `src/components/ai/ActionReviewPanel.tsx`; Erweiterungen in `AIConsultant.tsx`, `Upload.tsx`, `generate-daily-briefing`, `ai-consultant`, `mcp`

## Offen für später (nicht in diesem Schritt)

Push-Benachrichtigung bei hartem Negativ-Verdict — sinnvoll, aber erst wenn die Verdicts sich in der Praxis als treffsicher erweisen.
