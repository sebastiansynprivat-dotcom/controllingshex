## Ziel
Vor dem wöchentlichen Report-Generieren nimmst du **einmal** ein Sprach-Memo auf. Es erscheint als **Intro-Karte** in jedem Report, der in genau diesem Generierungslauf entsteht. Danach wird es automatisch als "verbraucht" markiert und rutscht **nicht** in später erzeugte Reports.

## User Flow
1. Auf `/coaching` oben neuer **Wochen-Memo-Recorder** (nutzt bestehende `CoachingMemoBar`-Optik, Owner-Only).
2. Du nimmst ein Memo auf → Status: **"Bereit für nächsten Report-Batch"**. Playback + Löschen/Neu aufnehmen möglich.
3. Du klickst wie gewohnt "Reports generieren" → Memo wird an jeden neu erzeugten Report als Intro-Karte gehängt.
4. Nach dem Batch: Memo bekommt `consumed_at`. Recorder zeigt "Verbraucht am …" mit Button "Neues Memo aufnehmen".
5. Nimmst du **kein** neues Memo auf und generierst später einen einzelnen Report → **kein Intro-Memo**.

## Chatter-Sicht
- Wenn ein Intro-Memo existiert, ist die erste Karte des Flows eine neue **Intro-Karte** ("Nachricht vom Boss vor dem Coaching") mit Play-Button. Ohne Memo bleibt der Flow unverändert.

## Technisches

### DB — neue Tabelle `coaching_pending_memos`
Genau ein aktiver Eintrag pro User (unique partial index auf `user_id WHERE consumed_at IS NULL`).
Felder (fachlich): `audio_path`, `duration_ms`, `consumed_at`, `consumed_report_ids uuid[]`. RLS: Owner-only. Grants auth+service_role.

### Storage
- Bucket `coaching-memos` (existiert). Upload unter `pending/{user_id}/{uuid}.webm`.
- Beim Attach an Reports wird **derselbe** `audio_path` in `coaching_memos` mit `card_key = 'weekly_intro'` referenziert (mehrere Rows teilen sich die Datei — kein Kopieren, kein Delete-on-consume).

### Frontend
- `src/lib/coaching.ts`: Neue Helpers `getPendingWeeklyMemo`, `uploadPendingWeeklyMemo`, `deletePendingWeeklyMemo`, `consumePendingWeeklyMemo(reportIds)`.
- `src/components/WeeklyIntroMemoCard.tsx` (neu): Recorder-Karte oben auf `/coaching`. Zeigt Status "Bereit" / "Verbraucht am … für N Reports".
- `src/pages/Coaching.tsx`: Rendert Karte oben. Beim Batch-Generieren:
  1. Vor dem Lauf `pending_memo_id` einmal auslesen.
  2. Nach jedem erfolgreich generierten Report → `INSERT INTO coaching_memos (coaching_id, card_key='weekly_intro', audio_path, duration_ms)`.
  3. Nach Batch-Ende: `consumePendingWeeklyMemo(alleReportIds)` → setzt `consumed_at` + speichert IDs.
- `src/pages/CoachingView.tsx`: Beim Aufbau des Kartenstacks prüfen, ob ein `coaching_memos`-Row mit `card_key='weekly_intro'` existiert. Wenn ja, als erste Karte einen neuen `kind: 'weekly_intro'` einfügen (großer Play-Button, Titel "Bevor du loslegst — kurz von mir"). Reuse `CoachingMemoBar` nur für Owner-Edit-Modus wird hier **nicht** gebraucht (Edit nur auf `/coaching`).

### Keine Edge-Function-Änderungen
`generate-coaching-analysis` bleibt unverändert. Attach + Consume laufen client-seitig — atomar genug, weil Batch-Loop im Frontend ohnehin sequenziell die Report-IDs sammelt.

## Edge Cases
- Neues Memo aufnehmen bei bereits vorhandenem pending → alte pending-Row wird gelöscht (inkl. Storage-File), neue erstellt.
- Generierung schlägt für einen Chatter fehl → Memo wird nur an erfolgreiche Reports gehängt.
- Kein pending Memo vorhanden → Flow unverändert, keine Intro-Karte.
- Manuelles Regenerieren eines einzelnen alten Reports zieht **kein** verbrauchtes Memo.

## Out of Scope
- Text-Memos, AI-generierte Memos, Zeitfenster-Ablauf.
