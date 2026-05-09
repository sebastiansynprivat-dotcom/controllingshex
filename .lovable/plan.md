## Ziel

Der Wechselmodus soll **nicht mehr** auf nackten 7T-Durchschnitten + Skill-Score (mass_dms / response_delay / open_chats) basieren — der ist ungenau, weil er nicht weiß **wie lange jemand wirklich gearbeitet hat** und **wieviel Volumen reingekommen ist**.

Stattdessen: **Live-Daten konsequent zwischenspeichern → echte Effizienz pro Chatter berechnen → Vorschläge nach „underused Skill" sortieren**.

---

## Was wir schon haben (nutzen, nicht neu bauen)

- `chatter_history_live` — Snapshot pro (Platform, Chatter, Tag): revenue, mass_dms, unread_chats, oldest_chat, **updated_at**.
- `chatter_hourly_stats` — pro Stunde aggregiert: revenue-Delta, mass_dms-Delta, **unread_delta** (negativ = abgearbeitet, positiv = neu rein), `updates_seen`.
- Trigger `record_live_activity_from_history_live` schreibt automatisch in hourly_stats wenn revenue/dms steigt oder unread sinkt → wir haben **schon jetzt** ein Aktivitäts-Pingsystem, müssen es nur sauber auswerten.

→ Retroaktive echte „incoming msgs" gibt's nicht, aber **ab jetzt** lässt sich aus `unread_delta` und `updates_seen` ein robuster Live-Effizienzwert berechnen, ohne Source-Anpassung.

---

## Was neu dazu kommt

### 1. Neue Tabelle `chatter_activity_sessions`
Pro Chatter zusammenhängende Online-Phasen, abgeleitet aus `updated_at`-Pings in `chatter_history_live`/`chatter_hourly_stats`:
- `user_id`, `platform`, `chatter_name`, `date`
- `started_at`, `ended_at`, `duration_min`
- `revenue_in_session`, `mass_dms_in_session`
- `incoming_proxy` (= Σ positiver `unread_delta` in der Session, +Σ `mass_dms` raus + Σ `−unread_delta`-bearbeitet)

Befüllung:
- Edge Function **`build-activity-sessions`** läuft stündlich (analog zu `snapshot-hourly-stats`).
- Logik: Pings in `chatter_hourly_stats` mit Lücke ≤ 25 min → eine Session. Aktivitäts-Ping = `revenue>0 ∨ mass_dms>0 ∨ unread_delta≠0` in der Stunde.
- Idempotent (UPSERT auf user_id, platform, chatter_name, started_at).

### 2. Neue Materialized-View / Aggregat `chatter_live_efficiency_7d`
Pro Chatter rolling 7d:
- `total_active_min` (Σ session duration)
- `total_revenue` (Σ revenue in Sessions)
- `total_incoming_proxy`
- abgeleitet:
  - **`eur_per_active_hour`** = revenue / (active_min/60)
  - **`eur_per_incoming`** = revenue / incoming_proxy
  - **`first_response_min_p50`** = Median Zeitspanne zwischen erstem Ping einer Session und erstem revenue/mass_dms-Event darin
  - **`session_consistency`** = (Tage mit ≥1 Session in Range) / Range-Tage

Refresh stündlich aus dem Session-Build-Job.

### 3. Live-Skill-Score (in `src/lib/swap-suggestions.ts`)
Bestehender Skill-Score wird **ersetzt** durch live-basierte Sub-Scores:

| Sub-Score          | Quelle                          | Gewicht |
|--------------------|---------------------------------|---------|
| `eur_per_hour`     | live_efficiency                 | 0.40    |
| `eur_per_incoming` | live_efficiency                 | 0.25    |
| `first_response`   | live_efficiency (lower better)  | 0.15    |
| `consistency`      | live_efficiency                 | 0.10    |
| `mass_dms`         | wie bisher (Disziplin)          | 0.10    |

Min-Max-Norm wie bisher gegen den Pool. Fallback auf alten Score wenn ein Chatter <3 Sessions in Range hat (frische Onboardings nicht abstrafen).

### 4. Neue Swap-Logik im Pairing
- **Underplaced** = hoher `eur_per_hour` ∧ hohe `eur_per_incoming` ∧ kleiner Account
- **Overplaced** = niedriger `eur_per_hour` ∧ großer Account
- Mismatch-Rang (wie heute) bleibt — aber auf Basis der neuen Live-Scores.
- `computeSwapExpectedGain` wird realistischer: statt Peer-Median × Skill verwenden wir
  `expected = right.followers_potential × left.eur_per_incoming_normalized` — was er pro Volumen rausholt × Volumen das der Ziel-Account liefert (geschätzt aus Peer-Cluster incoming_proxy).

### 5. UI-Anpassungen `SwapModeView`
- Skill-Bar bleibt, aber Breakdown-Pills: `€/h aktiv`, `€/Msg`, `Resp`, `Tage aktiv`.
- Header-Badge auf jeder Karte: „**X € / aktive h**" (klar lesbar) statt nur Skill 0.62.
- Tooltip / Detail-Block: „basiert auf N Live-Sessions in den letzten 7 Tagen" — Transparenz.
- Zeitraumtoggle (Heute / 7T / 14T / 30T) bleibt, läuft jetzt über das neue Aggregat.

---

## Migration / Reihenfolge

1. **Migration**: Tabelle `chatter_activity_sessions` + RLS (own user only) + Indizes (user_id, platform, chatter_name, date).
2. **Edge Function `build-activity-sessions`** + pg_cron stündlich. Backfill-Run einmal manuell für die letzten 14 Tage aus bestehenden `chatter_hourly_stats`.
3. **DB-Function `get_live_efficiency(p_user, p_platform, p_from, p_to)`** SQL — liefert das oben beschriebene Aggregat. Kein Materialized-View nötig solange Volumen klein.
4. **Frontend**:
   - neuer Helper `src/lib/live-efficiency.ts` lädt `get_live_efficiency` und cached pro Range.
   - `swap-suggestions.ts`: Sub-Scores + Pairing umstellen, alten Pfad als Fallback behalten.
   - `SwapModeView.tsx`: Pills + Header-Badge umtexten, Zeitraum bleibt.
5. Keine Anpassung an `LiveTracking.tsx`, `live-priority.ts`, `live-activity.ts` — die liefern weiterhin den Now-Status.

---

## Was bewusst NICHT drin ist

- Keine echten „incoming messages" aus der Source — die `incoming_proxy`-Heuristik ist explizit als Schätzung deklariert und reicht für relative Vergleiche im Swap.
- Kein Rückblick weiter als die vorhandenen `chatter_hourly_stats` (die existieren erst seit der Trigger live ist).
- Keine Änderung an Tier/Follower-Logik — Account-Größe bleibt die zweite Achse.

---

## Technisches Detail (für später / Implementierung)

- Session-Gap-Schwelle 25 min ist konfigurierbar via `settings.key='swap_session_gap_min'` (default 25).
- `first_response_min` braucht Minute-Granularität — wir nutzen `chatter_history_live.updated_at` für Session-Start (genauer als hourly stats) und das erste hourly-bucket mit revenue/mass_dms>0 als „erste Wirkung", clamp an Stundenanfang +30min Median.
- Min-Sample-Threshold: Chatter mit `total_active_min < 60` in Range bekommen Live-Score nicht — fallen auf alten Skill-Score zurück, Badge zeigt „Live-Score N/A".
- RLS für neue Tabelle: SELECT/INSERT/UPDATE/DELETE nur own user_id; service_role full access.

---

**Antwort kurz:** Ja, machbar — aber sauber nur **ab jetzt vorwärts**. Retro-Genauigkeit ist begrenzt durch das was schon in `chatter_hourly_stats` drin ist. Plan oben.
