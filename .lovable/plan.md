
# Smarter Auffälligkeiten-Block im Heute-Tab

Ziel: Der Heute-Tab wird die zentrale Anlaufstelle. Statt einer generischen Liste zeigt der Auffälligkeiten-Block nur das, was **heute wirklich zu tun** ist — priorisiert, bündelt, snooze-bar, und mit klarem Hinweis auf altlast-Fälle.

## Was ändert sich sichtbar

**1. Nur "Today-Fokus" statt globalem Zeitraumfilter**
Der Panel im Dashboard bekommt einen neuen Modus `variant="today"`:
- Zeitraumfilter (24h/7T/30T) wird ausgeblendet → im Heute-Tab immer **letzter Report + Vergleich zum Vortag**.
- Der volle Filter bleibt auf `/auffaelligkeiten` erhalten.

**2. Priority-Score statt "Top 5 nach Severity"**
Neue Sortierung pro Chatter-Gruppe:
```text
priority = severity_weight (crit=100, high=60, medium=30, info=10)
         + impact_eur_per_day * 2
         + freshness_bonus (heute neu: +40, gestern: +10, älter: 0)
         + age_penalty (>3 Tage offen: +25 als "Eskalation")
```
Nur die **Top 5** landen im Heute-Tab. Rest ist einen Klick weiter unter „Alle ansehen".

**3. Drei klare Sektionen im Panel**
```text
┌─ Neu heute (3) ─────────────────┐   ← neu seit letztem Report
│  · Chatter A — Revenue -42% …  │
├─ Eskaliert (1) ─────────────────┤   ← >3 Tage offen, unbearbeitet
│  · Chatter B — seit 4 Tagen    │
├─ Später (12) ───────┬───────────┤   ← kollabiert, ein Klick → /auff.
│  12 offen aus Vortagen  →      │
└──────────────────────┴──────────┘
```

**4. Snooze pro Karte**
Neben dem bestehenden ✓ (dismiss bis nächster Report) gibt es:
- **Snooze bis morgen** (Uhr-Icon) → verschwindet nur aus Heute, bleibt in `/auffaelligkeiten`.
- Karten aus dem Snooze tauchen am nächsten Tag automatisch wieder in „Neu heute" auf, sofern noch relevant.

**5. Kompakte „Erledigt heute"-Zeile am Ende**
```text
✓ 4 heute erledigt · rückgängig
```
Nicht störend, aber sichtbare Progress-Bestätigung.

## Datenmodell / Backend

**Neue Tabelle `anomaly_snooze`** (Cloud):
```text
id (uuid, pk)
user_id (uuid)
platform (text)
chatter_name (text)
anomaly_kind (text)     -- optional, sonst NULL = ganze Gruppe
snoozed_until (date)    -- 'tomorrow' → morgen 04:00 lokal
created_at (timestamptz)
```
RLS: `user_id = auth.uid()`. GRANTs für `authenticated` + `service_role`.

**Kein Backfill nötig** — Priorität + Sektionen werden client-seitig aus vorhandenen `chatter_history_live` / `anomaly_actions` berechnet. "Age" leitet sich aus `first_seen_date` je Anomalie ab (bereits im `computeAnomaliesForWindow`-Output enthalten; falls nicht, aus ältestem `analysis_date` in der Live-Reihe abgeleitet).

## Frontend-Änderungen

- `src/components/AnomalyPanel.tsx`: neuer `variant="today"`, Sektions-Layout, Prioritäts-Sortierung, Snooze-Button.
- `src/lib/anomaly-window.ts`: Helper `computePriorityScore(group)` + `getAnomalyAgeDays(anomaly)`.
- `src/lib/anomaly-snooze.ts` (neu): `snoozeAnomaly()`, `loadActiveSnoozes()`, Filter-Helper.
- `src/pages/Dashboard.tsx`: nutzt `variant="today"` mit `limit=5`.
- `src/pages/Anomalies.tsx`: zeigt gesnoozte mit dezenter Uhr-Markierung, „Snooze aufheben"-Button.

## Was **nicht** angefasst wird
- Bestehender Dismiss-Flow (✓ bis nächster Report) bleibt.
- Swipe-Mode, `/auffaelligkeiten`-Page, Zeitraum-Filter dort — unverändert.
- Restlicher Heute-Tab (Daily To-Dos, Recovery Queue, etc.) — unverändert.

## Offene Frage für später (nicht blockend)
Ob "Eskaliert" ab 3 oder 5 Tagen greifen soll — starte mit **3 Tagen**, justierbar per Konstante.
