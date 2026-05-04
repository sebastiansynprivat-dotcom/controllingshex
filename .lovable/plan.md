## Live-Tracking 2.0 — Priorisierte Action-Queue

Komplett-Redesign: Aus der Tabelle wird eine schlanke, nach Wichtigkeit sortierte Liste. Kleiner, luxuriöser, übersichtlicher.

### Priority-Score (0–100)

Score wird live clientseitig pro Chatter berechnet, basierend auf Live-Daten + 14-Tage-Schnitt aus `chatter_history`.

**Eskalation und Lost Potential gleich gewichtet (je 35%)**, Rest verteilt:

| Signal | Gewicht | Logik |
|---|---|---|
| Eskalation | 35 | `oldest_chat` Stunden, normalisiert: 0=0pt, ≥4h=full |
| Lost Potential | 35 | `(avg14d − todayRevenue) / avg14d`, gekappt auf 0–1 |
| Stau | 15 | `unread_chats / max(personalAvgUnread, 5)`, gekappt |
| AFK-Risk | 10 | Min seit `updated_at` × Erwartungsfaktor zur Uhrzeit |
| Mass-DM-Lücke | 5 | sendet sonst >0/Tag, heute = 0 |

Hot-Streak (`todayRevenue > 1.5× avg14d`) → Score wird auf max 30 gedeckelt → landet automatisch im „Läuft"-Bucket.

### „Noch nicht am Start" (kombiniert)

Banner-Warnung wenn Chatter **beides** zeigt:
1. Keine Zeile in `chatter_history_live` heute  **ODER** Revenue heute < 20% des erwarteten Stands für die aktuelle Uhrzeit
2. Ist im 14-Tage-Schnitt normalerweise um diese Uhrzeit aktiv

Stundenweiser Erwartungswert: aus historischer Verteilung (vereinfacht: linear über den Tag basierend auf avg14d).

### 3 Buckets

```text
🔴 SOFORT       Score ≥ 70   immer expanded
🟡 BEOBACHTEN   40–69        immer expanded
🟢 LÄUFT        < 40         eingeklappt, „X Chatter laufen sauber" — Klick öffnet
```

Hot-Streak-Chatter im Läuft-Bucket bekommen ein dezentes ↑-Icon.

### Layout

Eine zentrierte Spalte, max ~720px. Keine Tabelle.

```text
                Live · Maloum
       vor 2min · 23 aktiv · 1.847€ heute

   ────────────────────────────────────

   ⚠ 3 Top-Chatter heute noch nicht am Start
     ~890€ erwartetes Potential offen

   ────────────────────────────────────
   SOFORT
   
   ●  Sylvia Ja                       92
      3 Std Stau · 14 ungelesen · −60€
   
   ●  björn da                        78
      AFK 32min · sonst 290€/Tag · −210€
   
   ────────────────────────────────────
   BEOBACHTEN
   
   ○  wencke wa                       54
      keine Mass-DMs · 28€ · −45€
   
   ○  martin mo                       42
      Stau steigt · 8 ungelesen
   
   ────────────────────────────────────
   ▸ 9 Chatter laufen sauber          ↑3
```

Pro Zeile:
- Status-Dot links (gefüllt = online, leer = idle/offline)
- Name in einer Zeile, Score rechts groß tabular-nums
- Sub-Zeile: Top-Reason + max 2 Sub-Signale, getrennt mit `·`
- Trennlinien `border-white/[0.04]`, kein Hintergrund pro Zeile
- Klick → existierender ChatterSlideOver

Header schrumpft auf eine Zeile (Plattform · Sync-Zeit · Aktiv-Count · Σ Revenue heute).

### Filter (minimal)

Drei Pillen rechts oben:
- Alle (Default)
- Nur Eskalation
- Lost Potential

Suche als Icon-Button, expandiert bei Klick. Keine Sort-Buttons (Score-Sort fix).

### Smart-Banner oben

Eine diskrete Zeile direkt unter dem Header, nur wenn Trigger feuert:
- „X Top-Chatter heute noch nicht am Start · ~Y€ Potential offen"
- „Höchstes Stau-Volumen seit 7 Tagen"
- „Z Chatter über 10 ungelesen"

Banner verschwindet automatisch sobald Bedingung nicht mehr gilt.

---

### Technisches

**Datei:** `src/pages/LiveTracking.tsx` (komplett neu)
**Helper neu:** `src/lib/live-priority.ts` — Score-Berechnung + Bucket-Zuordnung + Top-Reason-String

**Datenfluss:**
1. Mount: Fetch `chatter_history_live` für heute + Plattform (wie jetzt)
2. Mount: Fetch `chatter_history` letzte 14 Tage für Plattform → Map<chatter_name, {avgRevenue, avgMassDms, avgUnread}>
3. Score-Compute pro Live-Row aus beiden
4. Realtime bleibt (filtered auf platform)
5. 1s-Tick für AFK-Berechnung & relative Zeiten

**Was bleibt unverändert:**
- Edge Function `upsert-chatter-live`
- Tabelle `chatter_history_live` + RLS
- Sidebar-Eintrag, Route `/live`
- ChatterSlideOver-Integration

Keine DB-Änderungen nötig.
