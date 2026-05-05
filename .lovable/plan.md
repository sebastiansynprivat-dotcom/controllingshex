# Live-Tracking: Aktivitäts-Logik & smartes Pacing

## Ziel

Zwei Dinge sauber bauen:

1. **Aktiv/Inaktiv pro Tag** — jeder Chatter soll heute mindestens **einmal** aktiv gewesen sein. Egal wann. Nicht "konstant on", sondern "hat heute überhaupt was gemacht".
2. **Live-Pacing während er aktiv ist** — vergleicht aktuelle Stunde mit seinem persönlichen Schnitt zur gleichen Uhrzeit. Sanftes Motivieren statt Strafen.

---

## Teil 1 — Was zählt als "aktiv heute"?

Ein Chatter gilt als **aktiv heute**, sobald **eines** davon zutrifft:

- Hat heute **Umsatz** > 0 €
- Hat heute mindestens **1 Mass-DM** rausgeschickt
- Hat heute seine **Chats abgearbeitet** = `unread_chats` ist im Tagesverlauf gesunken (mindestens einmal niedriger als beim ersten Eintrag des Tages, oder aktuell deutlich niedriger als sein persönlicher Durchschnitt)
- Hat heute mindestens **N Tracker-Updates** mit Veränderung (Bot hat tatsächlich Bewegung gesehen, nicht nur Heartbeat)

Wer **keines** davon erfüllt → **inaktiv heute**.

Filter-Pills im Live-Tab werden:
- `Alle` · `Aktiv heute` · `Inaktiv heute` · `Eskalation` · `Lost Potential`

Aktuell zeigt "Alle" nur Chatter mit Live-Eintrag. Neu: **"Alle" zeigt alle bekannten Chatter** (aus `chatter_history` der letzten 14 Tage), inkl. derer ohne Live-Eintrag heute → die landen automatisch in "Inaktiv".

## Teil 2 — Persönliches Aktivitätsprofil (für Pacing)

Pro Chatter wird aus den letzten **14–30 Tagen** ein **Stundenprofil** berechnet:

- Welche Stunden ist er normalerweise aktiv? (z. B. Lisa typisch 10–14h und 19–23h)
- Wie viel Umsatz macht er typischerweise **pro Stunde**?
- Wie viele DMs / wie viele bearbeitete Chats pro Stunde?

Damit kann das System sagen:
- "Tom ist gerade in seinem **stärksten Zeitfenster** (sonst 80€/h um diese Zeit) — aktuell 20€/h → −60€ Pacing-Gap"
- "Lisa ist gerade in einem **schwachen Fenster** (macht sonst auch wenig) — alles ok, kein Alarm"

→ Keine falschen Alarme mehr, weil heute jemand morgens noch nicht aktiv ist, der eh erst abends arbeitet.

## Teil 3 — Anzeige im Live-Tab

Drei klare Buckets statt Score:

```text
AKTIV & STARK
  Chatter, die gerade in ihrem Fenster sind und auf/über Pacing
  → grün, dezent, kein Action-Druck

AKTIV ABER UNTER PACING
  Im typischen Fenster, aber heute schwächer als sonst
  → amber, mit Begründung: "sonst 120€ um diese Zeit, jetzt 40€"
  → Motivations-Ping möglich

INAKTIV HEUTE
  Hat heute noch gar nichts gemacht (kein Umsatz, keine DM, Chats nicht bewegt)
  → wird mit erwarteter Tagesleistung angezeigt
  → Sortiert nach "Top-Verdiener zuerst"
```

Pro Chatter-Karte:
- Status-Dot: grün (gerade aktiv, letzte 15 min Bewegung) · amber (heute schon aktiv, gerade Pause) · grau (heute noch nie aktiv)
- Mini-Sparkline: Umsatz heute pro Stunde vs. persönlicher Schnitt
- Begründung in Klartext, kein Score: "letzte Aktivität 2h her", "−60€ vs. typisches Fenster", "30 Chats bearbeitet seit Mittag"

---

## Technische Umsetzung

### Aktivitäts-Detektion

Im Frontend (`src/lib/live-activity.ts`, neu):
- `computeIsActiveToday(liveRow, history)`: prüft Umsatz, DMs, Unread-Reduktion
- `computeHourlyProfile(history14d)`: aggregiert Umsatz/Aktivität pro Stunde × Wochentag
- `computeExpectedThisHour(profile, now)`: erwartete Werte für aktuelles Zeitfenster
- `computePacingDelta(currentHourActual, expected)`: Gap in € + relative %

### Datenquellen

- `chatter_history_live` (heute, alle Snapshots) → Aktivität heute, Verlauf der Stunden
- `chatter_history` (14–30 Tage) → Tagesschnitte
- **Neu nötig**: Stunden-Auflösung. Aktuell ist `chatter_history` tagesgranular. Für ein präzises Stundenprofil brauchen wir entweder:
  - **Variante A (schnell)**: Tagesschnitt × statisches Tageskurven-Profil (6–24h linear) → grobes Pacing, sofort verfügbar
  - **Variante B (präzise, später)**: `chatter_history_live` Snapshots werden archiviert (z. B. tägl. Job kopiert Stunden-Buckets in eine neue Tabelle `chatter_hourly_stats`) → echtes Stundenprofil nach 7–14 Tagen Sammeln

→ Schritt 1 baut Variante A, parallel legen wir die Tabelle für B an, damit ab morgen Daten gesammelt werden.

### Datenbank

Neue Tabelle `chatter_hourly_stats`:
- `user_id`, `platform`, `chatter_name`, `date`, `hour` (0–23)
- `revenue`, `mass_dms`, `unread_delta` (wie viele Chats abgearbeitet in der Stunde)
- RLS: nur eigene Daten

Neue Edge Function `snapshot-hourly-stats` (cron stündlich):
- Liest `chatter_history_live` aktuelle Werte
- Berechnet Delta zur letzten Stunde
- Schreibt in `chatter_hourly_stats`

### UI-Änderungen `LiveTracking.tsx`

- Filter-Pills neu: `Alle (inkl. inaktive) · Aktiv heute · Inaktiv heute · Eskalation · Lost Potential`
- "Alle" lädt zusätzlich `chatter_history` letzte 14 Tage → Vereinigung mit Live-Daten, fehlende = inaktiv
- Buckets neu: `Aktiv & stark` / `Aktiv unter Pacing` / `Inaktiv heute`
- Score entfernen, durch Pacing-Delta ersetzen (€-Gap zur typischen Stunde)
- Sparkline pro Karte (Umsatz heute pro Stunde)

### Was später kommt (nicht in diesem Schritt)

- Sender-Healthcheck/Diagnose-Banner
- KI-Coach-Pings
- End-of-Shift Reports

---

## Reihenfolge

1. `computeIsActiveToday` + Filter "Inaktiv heute" mit allen bekannten Chattern (sofortiger Mehrwert)
2. Variante-A Pacing (Tagesschnitt × Tageskurve) + neue Buckets + Score raus
3. Tabelle `chatter_hourly_stats` + Cron-Snapshot anlegen (sammelt ab Tag 1)
4. Nach 7–14 Tagen: Variante B aktivieren — präzises Stundenprofil pro Chatter
