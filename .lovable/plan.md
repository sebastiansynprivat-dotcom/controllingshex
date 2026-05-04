## Live-Tracking Tab

Neuer Bereich in der Sidebar direkt unter „Dashboard": **Live-Tracking** (`/live`). Zeigt in Echtzeit, was die Chatter gerade tun — auf Basis von `chatter_history_live` (Revenue, Mass-DMs, Unread Chats, Oldest Chat, updated_at).

### Was sinnvoll ist mit den Live-Daten

Die Tabelle hat 5 starke Signale pro Chatter:
- **revenue** — Tagesumsatz live
- **mass_dms** — gesendete Mass-DMs heute
- **unread_chats** — wie viele Kunden warten gerade
- **oldest_chat** — ältester unbeantworteter Chat (Stunden/Tage)
- **updated_at** — wann zuletzt Daten gepusht

Daraus lassen sich vier Live-Use-Cases bauen, die im Tab als smarte Filter-Pillen oben sitzen:

```text
┌─────────────────────────────────────────────────────────┐
│ Live-Tracking · 23 Chatter aktiv · letzte Sync vor 2min │
├─────────────────────────────────────────────────────────┤
│ [ Suche ] [ Plattform: Alle / Maloum / Brezzels ]       │
│                                                         │
│ Smarte Filter:                                          │
│  ◉ Alle                                                 │
│  ○ Eskalation (oldest_chat ≥ 2)                         │
│  ○ Überlastet (unread ≥ 10)                             │
│  ○ Inaktiv (kein Update > 30min)                        │
│  ○ Top Performer heute (Revenue Top 5)                  │
│  ○ Keine Mass-DMs heute                                 │
│  ○ Online jetzt (Update < 5min)                         │
│                                                         │
│ Sortierung: Revenue ↓ / Unread ↓ / Oldest ↓ / Letzte    │
├─────────────────────────────────────────────────────────┤
│ KPI-Strip: Σ Revenue heute · Σ Mass-DMs · Σ Unread ·    │
│            Ø Oldest · Anzahl aktiv (<15min)             │
├─────────────────────────────────────────────────────────┤
│ Live-Tabelle                                            │
│  ● Status | Chatter | Plattform | Revenue | Mass-DMs |  │
│    Unread | Oldest | Letzte Sync                        │
│                                                         │
│  ● grün  = Update < 5min   (online)                     │
│  ● gelb  = 5–30min         (idle)                       │
│  ● grau  = > 30min         (offline)                    │
│  ● rot-Badge auf Oldest ≥ 2  bzw. Unread ≥ 10           │
│                                                         │
│ Klick auf Zeile → ChatterSlideOver (existiert)          │
└─────────────────────────────────────────────────────────┘
```

### Smarte Filter im Detail

| Filter | Logik | Zweck |
|---|---|---|
| **Eskalation** | `oldest_chat ≥ 2` | Kunden warten zu lange — sofort handeln |
| **Überlastet** | `unread_chats ≥ 10` | Chatter braucht Support / Umverteilung |
| **Inaktiv** | `now() - updated_at > 30min` | Pause/AFK erkennen |
| **Online jetzt** | `now() - updated_at < 5min` | Wer ist gerade aktiv am Chatten |
| **Top Performer** | Top 5 nach `revenue` heute | Wer läuft heiß |
| **Keine Mass-DMs** | `mass_dms = 0` und Revenue niedrig | Wer schiebt nicht |
| **Stille Goldgruben** | `revenue > Median` und `unread = 0` | Effiziente Chatter |

Filter sind als Toggle-Pillen kombinierbar (AND).

### Live-Aktualisierung

Realtime via Supabase Channel auf `chatter_history_live` — Tabelle aktualisiert sich automatisch sobald neue Pushes via Edge Function reinkommen. Zusätzlich „Letzte Sync vor X" relativ-Timer, der jede Sekunde tickt.

### Verbindung zu existierenden Daten

- Spalte „Heute" zeigt zusätzlich aus `chatter_history` den letzten Report-Wert in klein darunter (z.B. „Live: 66€ · Report: 0€") — macht Diskrepanzen sichtbar.
- Zeilen-Klick öffnet das bestehende `ChatterSlideOver` (zeigt schon Live-KPIs).

---

### Technisches

**Neue Datei:** `src/pages/LiveTracking.tsx`
- State: `rows` (aus `chatter_history_live`), `filter` (Set), `sort`, `search`, Platform aus `PlatformContext`
- Initial-Fetch: heutiges Datum, optional plattform-gefiltert
- Realtime-Subscription auf Tabelle, payload merged in `rows`
- Tick-Interval (1s) für relative Zeitanzeigen
- Helper: `secondsSinceUpdate(updated_at)`, `statusOf(row)` → 'online'|'idle'|'offline'

**Sidebar:** `src/components/AppSidebar.tsx` — neuer Eintrag „Live-Tracking" (Icon `Activity` o. `Radio`) direkt nach „Dashboard".

**Routing:** `src/App.tsx` — Route `/live` → `<LiveTracking />`.

**RLS-Hinweis:** `chatter_history_live` hat aktuell **keine RLS-Policies**. Da Daten von extern via Edge Function geschrieben werden und alle Workspace-Nutzer sie sehen sollen, brauchen wir eine SELECT-Policy für `authenticated` (sonst sieht der Browser-Client nichts):

```sql
ALTER TABLE chatter_history_live ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view live data"
ON chatter_history_live FOR SELECT TO authenticated USING (true);
```

Realtime aktivieren:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE chatter_history_live;
```

Keine weiteren Schema-Änderungen.
