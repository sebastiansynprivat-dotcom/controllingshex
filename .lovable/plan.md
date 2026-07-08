## Ziel

Neuer Sidebar-Reiter **"Nachrichten"** (`/nachrichten`), der pro Chatter live zeigt:
- wie viele Nachrichten heute reinkamen (Proxy),
- wie viel Umsatz daraus wurde,
- **€ pro eingehender Nachricht** als Effizienz-Kennzahl.

Standard-Sortierung: meiste Nachrichten oben. Toggle-Button zum Umkehren. Zusätzlich Sortier-Umschalter für Umsatz / €-pro-Msg, damit du auf einen Blick siehst, wer viel bekommt aber wenig draus macht → Tausch-Signal.

## Datengrundlage

**Live-Proxy pro Push** (aus `chatter_history_live`, alle 10–15 min):
```
incoming_delta = max(0, unread_now − unread_last_push)
               + max(0, revenue_now − revenue_last_push) > 0 ? 1 : 0
```
Jede Umsatzsteigerung zählt als mindestens 1 eingehende Nachricht (Kauf setzt Chat voraus). Aufsummiert pro Chatter/Schicht-Tag = `incoming_count`. Bei 3–4h Schicht ergibt das 12–18 Datenpunkte pro Chatter — genug für Größenordnung und Ranking, nicht Message-genau. Wird im UI transparent als "~" (geschätzt) markiert.

**Speicherung:** Neue Tabelle `chatter_incoming_stats` (user_id, platform, chatter_name, date, incoming_count, last_unread, last_revenue, updated_at). Wird bei jedem `upsert-chatter-live`-Push nachgeführt.

## Backfill für historische Tage

Zusätzlich rückwirkende Berechnung aus `chatter_hourly_stats` (die Tabelle hält Stundensnapshots seit Projektstart, siehe `snapshot-hourly-stats`).

**Backfill-Formel pro Chatter/Tag:**
```
incoming_count(day) = Σ über alle Stundenslots:
    max(0, unread_delta_neg)   // wenn unread runtergegangen → gelesene Msgs
  + (revenue_hour > 0 ? 1 : 0) // jede Stunde mit Umsatz = mind. 1 Kauf
```
Wobei `unread_delta_neg = max(0, unread_prev_hour − unread_this_hour)`. Positive Deltas (neue Msgs kommen rein) sind bereits im nächsten `unread_delta_neg` enthalten, sonst würden wir doppelt zählen. Alternative Variante wird vor Umsetzung mit Beispieldaten gegengeprüft.

**Umsetzung:**
- Neue Edge Function `backfill-incoming-stats`:
  - Optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` Parameter, default = alle verfügbaren Tage.
  - Liest `chatter_hourly_stats` gruppiert pro user/platform/chatter/date.
  - Rechnet Formel, upsert in `chatter_incoming_stats` (onConflict user_id,platform,chatter_name,date).
  - Idempotent: mehrfach ausführbar, gleicher Output.
- Wird **einmal manuell** nach dem Deployment getriggert (Admin-Button in Settings oder direkter Aufruf), danach übernimmt der Live-Path für den aktuellen Tag.
- History-Tage im UI verfügbar über einen Datums-Range-Switcher: "Heute" / "Letzte 7 Tage" / "Letzte 30 Tage".

**Genauigkeitshinweis:** Backfill ist noch gröber als Live (Stundenauflösung statt 15 min), aber gut genug für Trends. Im UI unterschieden über Badge "geschätzt (Backfill)" bei historischen Tagen.

## UI — Premium Layout

Route `/nachrichten`, Sidebar-Icon: `Inbox` (lucide).

Aufbau (mobile-first, max-w-2xl zentriert):

```text
┌─────────────────────────────────────────┐
│  NACHRICHTEN                            │
│  Wer bekommt wie viel — und macht was   │
│  daraus.                                │
├─────────────────────────────────────────┤
│  [Heute ▾]  [Sortieren: Msgs ↓]  [Live●]│
├─────────────────────────────────────────┤
│  #1  ANNA                    ~340 msg   │
│  ████████████████░░░  1.240 €           │
│  3,65 €/msg    · aktiv vor 2 min        │
├─────────────────────────────────────────┤
│  #2  LEA                     ~280 msg   │
│  ██████████░░░░░░░░░    420 €           │
│  1,50 €/msg    · Rückgang               │
├─────────────────────────────────────────┤
│  ...                                    │
└─────────────────────────────────────────┘
```

**Card-Design pro Chatter:**
- Rank-Nummer groß, dünn (font-light, gold-tint für Top 3).
- Chatter-Name in Uppercase-Tracking.
- Rechts: `~340 msg` mit Tilde (signalisiert Schätzung).
- Progress-Bar: Länge = Umsatz relativ zum Top-Chatter. Farbe = € pro Message (grün ≥ Ø, amber < Ø, rot ≪ Ø).
- Sub-Zeile: `€/msg` groß + Live-Status ("aktiv vor Xmin" / "Pause" / "offline") mit pulsierendem Dot.
- Sanfte Hover-Elevation, backdrop-blur, border white/[0.06], gradient analog `PushCounterCard`.

**Header-Controls:**
- Datums-Dropdown: Heute / Letzte 7 Tage / Letzte 30 Tage.
- Sortier-Dropdown: Nachrichten / Umsatz / €-pro-Msg.
- Richtungs-Toggle (↑↓).
- Live-Dot mit "letzter Push vor Xmin".

**Empty-State** für Chatter ohne Signal: ausgegraut ganz unten, "heute noch kein Signal".

## Technische Details

1. **Migration:** neue Tabelle `chatter_incoming_stats` + Index auf (user_id, platform, date) + RLS + GRANT (analog `chatter_history_live`).
2. **Edge Function `upsert-chatter-live`:** vor dem Upsert alten Snapshot aus `chatter_history_live` lesen → Diff berechnen → `chatter_incoming_stats` upserten. Additiv, alter Flow unangetastet.
3. **Edge Function `backfill-incoming-stats`:** neue Function, service-role, iteriert `chatter_hourly_stats`, füllt `chatter_incoming_stats` idempotent.
4. **Frontend:**
   - `src/pages/Messages.tsx` (Route `/nachrichten`).
   - `src/components/messages/ChatterMessageRow.tsx`.
   - Query via `supabase.from('chatter_incoming_stats')` + Join auf `chatter_history_live` für Live-Status.
   - Realtime-Subscription für automatisches Re-Ranking.
   - Range/Sort-State in `useState`, Default: heute, `incoming_count desc`.
5. **Sidebar:** Eintrag zwischen "Live-Tracking" und "Push".
6. **App.tsx:** Route `/nachrichten`.
7. **Backfill-Trigger:** einmaliger Aufruf nach Deployment via `supabase.functions.invoke('backfill-incoming-stats')` — Button dezent in Settings, oder ich triggere es einmal für dich.

## Was bewusst NICHT drin ist

- Kein Reply-Time-Tracking (braucht anderes Extension-Signal).
- Keine Message-genaue Historie — bewusst als Schätzung markiert.

Reihenfolge beim Bau: Migration → Live-Edge-Function-Erweiterung → Backfill-Function → UI → Backfill einmal triggern.