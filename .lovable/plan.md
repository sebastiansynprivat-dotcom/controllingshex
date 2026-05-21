
## Ziel

Du redest am Ende des Tages nur noch mit **Alex** (CEO). Alex kennt deine Kontext-Notizen zu jedem Chatter, kennt die Patterns aus den Daten, weiß was letzte Woche entschieden wurde, und sagt dir was **heute zählt** — nicht "Tom hat 3 Mass-DMs". Sondern: *"Sarah hat seit 3 Tagen Versprochen aber nichts geliefert — du hattest am 18. mit ihr 'noch 2 Tage' vereinbart. Heute läuft die Frist ab."*

Kein neues Dashboard. Ein **Chat** + **Heartbeat-Pings**.

---

## Was das Team wirklich kann (Mehrwert ohne Telegram-Tracking)

Vier Agents laufen stündlich. Kein Smalltalk in Reports — nur **Findings die Handlung auslösen**.

### 1. Pattern-Agent (das Killer-Ding)

Macht **nicht** "Durchschnitt Mass-DMs = 3". Macht:

- **Korrelationen**: *"Wenn Lisa morgens >2 Mass-DMs macht, hat sie nachmittags +40% Revenue. Letzte 3 Tage hat sie morgens 0 gemacht."*
- **Regime-Shifts**: *"Tom ist seit 4 Tagen in anderem Modus — früher Spike 18–22 Uhr, jetzt flach durchgehend. Wahrscheinlich passive Phase."*
- **Vergleichs-Insights**: *"Top 3 Chatter haben gestern alle bei Model X gepusht. Bottom 3 nicht. Model X läuft +180% — kannst du als Standard setzen?"*
- **Frühindikatoren**: *"Sarahs first-response-Zeit ist von 4min auf 18min gestiegen — historisch geht ihr Revenue 2 Tage später -30%."*

### 2. Memory-Agent (deine Notizen + Erinnerungen)

- Du sagst Alex per Voice oder Text: *"Mit Sarah grad gesprochen, gibt ihr noch 2 Tage zum Mass-DM hochfahren."*
- Wird gespeichert als `chatter_memo` mit `follow_up_at = +2d`, `topic = "mass_dms_low"`.
- Alex pingt dich am Tag X um 8:00: *"Frist Sarah läuft heute ab — letzte 2 Tage Mass-DMs: 1, 0. Hat nicht geliefert."*
- Bei jedem zukünftigen Briefing über Sarah taucht das Memo auf: *"Vereinbart 18.: Mass-DMs hochfahren."*
- Memos sind suchbar: *"Was hatte ich mit Lisa zuletzt besprochen?"*

### 3. Action-Effect-Agent

Du hast vor 3 Tagen entschieden "Tom Cut bei Model Y". Agent checkt automatisch:
- Hat Tom Model Y tatsächlich gedroppt? (Daten-Check)
- Wenn ja: Revenue-Delta vs. Baseline → *"Cut hat +€340/Tag gebracht."*
- Wenn nein: Eskalation an dich.

Das ist der **Loop, der dem Dashboard fehlt**: Entscheidung → Wirkung gemessen → gelernt.

### 4. QM-Filter

Sitzt zwischen den Agents und Alex. Killt Duplikate, dedupliziert über 7 Tage, sortiert nach Estimated-€-Impact, schmeißt alles raus was <€50/Tag bewegt. Du kriegst **3–7 Findings pro Tag**, keine 30.

---

## Alex (CEO) — der einzige Touchpoint

Eine Route: `/alex`. Chat-UI wie ChatGPT. Drei Modi:

1. **Daily Brief** (8:00 push): *"3 Sachen heute — Sarah Frist läuft ab, Pattern bei Lisa morgens, Model X Standard-Empfehlung."* Du tappst rein, kriegst Detail + Buttons (Done / Snooze 2d / Ignore).
2. **Heartbeat** (jede Stunde stille Berechnung, ping nur wenn was Wichtiges): *"Tom seit 2h inaktiv obwohl Prime-Time — letzte Woche selbe Zeit €240."*
3. **Freier Chat**: *"Was war mit Sarah letzte Woche?"* → zieht Memos + Daten. *"Notier: Lisa bekommt bis Freitag Zeit"* → erstellt Memo + Reminder.

### Tools die Alex aufruft

- `read_patterns(chatter?, days?)` — neueste Pattern-Findings
- `read_memos(chatter?)` — deine Notizen
- `create_memo(chatter, text, follow_up_days?)` — Memo + Reminder
- `read_action_effects(action_id?)` — was hat gewirkt
- `read_live_numbers(chatter?, range?)` — aktuelle Zahlen on-demand
- `mark_action_done(id)` / `snooze(id, days)`

Alex wird mit System-Prompt geprimt: *Antworte kurz, keine Generic-Phrasen, immer mit €-Impact wenn möglich, frag nach wenn unklar.*

---

## Architektur

```text
stündlich (cron)
  ├── pattern-agent  ─┐
  ├── action-agent   ─┤
  └── memory-agent   ─┤
                     ▼
                  qm-filter  ──► agent_findings (gefiltert, ranked)
                                       │
                              8:00 ──► alex-brief (Daily Brief)
                              live ──► /alex Chat (on-demand)
```

### Neue Tables

- `chatter_memos` — `chatter_name`, `text`, `created_at`, `follow_up_at?`, `topic?`, `status` (open/resolved)
- `agent_findings` — `agent`, `chatter_name?`, `kind` (pattern/anomaly/effect/reminder), `title`, `detail`, `estimated_eur_impact`, `evidence_json`, `created_at`, `dedup_key`, `status`
- `alex_messages` — Thread-Persistenz für Chat
- `action_effects` — was wurde entschieden, was ist Baseline, was ist gemessen

### Neue Edge Functions

- `agent-patterns` (stündlich) — Korrelationen/Regime-Shifts auf `chatter_hourly_stats` + `chatter_activity_sessions`
- `agent-memory` (stündlich) — checkt fällige Memos → Findings
- `agent-effects` (stündlich) — misst Wirkung früherer Aktionen
- `qm-filter` (stündlich nach Agents) — dedup, rank, cap
- `alex-chat` (stream) — Gemini 2.5 Pro mit Tool-Calling via AI SDK + Lovable Gateway
- `alex-daily-brief` (8:00 cron) — generiert Daily-Brief-Message

---

## UI-Änderungen (minimal)

- **Sidebar**: "AI Consultant" → **"Alex"** mit Badge (offene Findings-Count)
- **Neue Route** `/alex` — Chat-UI, Thread pro Tag
- **ChatterSlideOver**: neuer Tab "Memos" — alle Notizen + Add-Button (Text oder 🎤)
- **Heartbeat-Toast** (oben rechts, dezent) wenn neuer wichtiger Finding kommt — Click → öffnet Alex
- Existierende Pages (Today, Dashboard etc.) bleiben unverändert

---

## Phasen

**Phase 1 — Memo + Reminder Loop** (kleinster Schritt mit sofortigem Nutzen)
- `chatter_memos` Table
- Memo-Tab im ChatterSlideOver (Text + Voice via vorhandene `generate-voice-memo`-Pipeline rückwärts → Whisper-Transcribe)
- Quick-Action: *"Notier: noch 2 Tage"* → Memo + Follow-up

**Phase 2 — Alex Chat** (Touchpoint steht)
- `/alex` Route, `alex-chat` Edge Function (AI SDK + Gemini 2.5 Pro)
- Tools: `read_memos`, `create_memo`, `read_live_numbers`
- Thread-Persistenz `alex_messages`
- Sidebar-Umbau

**Phase 3 — Pattern-Agent + QM**
- `agent_findings` Table
- `agent-patterns` Edge Function (Korrelationen, Regime-Shifts)
- `qm-filter`
- Daily Brief 8:00 cron
- Heartbeat-Toast

**Phase 4 — Action-Effect-Loop**
- `action_effects` Table (oder bestehende `action_outcomes` erweitern)
- `agent-effects` Edge Function
- Buttons "Done / Snooze" in Alex-Chat schreiben in Action-Effects

---

## Open Decisions (vor Build)

1. **Voice-Memos**: Whisper via Lovable AI / ElevenLabs (du hast Key)? Oder erstmal nur Text-Memo + später Voice nachrüsten?
2. **Heartbeat-Frequenz**: Jede Stunde Agent-Run, aber Ping nur bei `estimated_eur_impact > X`. Sollte X = €100/Tag sein (≈3–7 Pings/Tag) oder strenger €200 (1–3/Tag)?
3. **Pattern-Tiefe Phase 3**: Reicht Korrelations-Heuristik (Quantile + Z-Score auf hourly_stats) oder soll Gemini direkt über die Daten reasonen (teurer, aber findet auch weiche Patterns)? Empfehlung: Heuristik als Pre-Filter, Gemini schreibt nur die finalen 5 Findings als menschliche Sätze.
4. **Alex-Tone**: Sachlich-knapp ("Sarah-Frist heute fällig. Hat nicht geliefert. Cut?") oder coachender ("Schau mal bei Sarah rein — ihr habt am 18. vereinbart…")?
