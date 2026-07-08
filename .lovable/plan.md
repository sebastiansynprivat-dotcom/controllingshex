## Downgrade-Kandidaten in "Heute"

Neben "Upgrade-Kandidaten" bekommt "Heute" eine eigene Karte "Downgrade-Kandidaten". Sie zeigt zwei klar getrennte Gründe an, warum jemand runtergestuft oder rausgenommen werden sollte — direkt im Warum-Text sichtbar.

### Auslöser (zwei Buckets)

**A) Komplett inaktiv (Chatter-Ebene)**
- Chatter ist im letzten Report (nach aktuellem Roster-Fix bereits gefiltert) — hat aber im relevanten Zeitfenster **keine** Aktivität:
  - 0 aktive Sessions **und** 0 Umsatz **und** 0 Mass-DMs **und** 0 bearbeitete eingehende Nachrichten.
- Fenster: Standard **7 Tage** (rollierend, exkl. Onboarding-Tage: erst ab Tag 4 nach `onboarded_on`).
- Warum-Text: „Seit X Tagen keine Session, kein Umsatz, keine Nachrichten bearbeitet. Onboarding: Tag Y."

**B) Volumen ohne Konversion (Chatter × Account)**
- Aktive Chatter-Account-Kombination, die viel eingehendes Volumen abbekommt, es aber schlecht in Umsatz dreht — die gleiche Logik wie „Potenzial verschenkt" auf Messages, hier aber härter getriggert:
  - Nachrichten ≥ **max(30, Median der Kombinationen)** im Zeitfenster,
  - €/Msg **≤ 50 %** des Plattform-Ø (gewichtet nach Volumen),
  - Persistenz: gilt an **≥ 3 der letzten 7 Tage** (kein Ein-Tages-Ausreißer).
- Warum-Text: „Account bekommt Ø X Msg/Tag, aber nur Y €/Msg (Plattform-Ø Z €/Msg — 55 % darunter). 3 von 7 Tagen im gleichen Muster."

### Impact-Berechnung
- **Inaktiv:** `costOfInaction = lastKnownAvgRevenuePerDay * 7`, Fallback auf Peer-Median des Accounts, falls kein eigener Wert vorhanden.
- **Volumen ohne Konversion:** `(plattform_€_pro_Msg * 0.7 − aktuelles_€_pro_Msg) * msgs_pro_Woche` — konservativ auf 70 % Plattform-Ø gekappt.

### Dedup & Sortierung
- Pro Chatter maximal **eine** Karte. Wenn beide Buckets zutreffen → Bucket A gewinnt (Inaktivität ist die härtere Aussage).
- Wenn Bucket B mehrfach zutrifft (mehrere Accounts) → höchstes Volumen gewinnt, weitere Accounts werden im Warum-Text als Nebenevidenz erwähnt.
- Sortierung: nach Impact absteigend, Bucket A vor B bei Gleichstand.

### Roster-Filter
- Es gilt der bereits gebaute Roster-Filter (nur Chatter aus dem letzten Report). Keine karteileichen.

### Bestehende `downgrade`-Logik
Die aktuelle Karte wird von `account-swap-engine.ts` (`zero_streak / delay / underperformance` pro Chatter+Account) gespeist. Diese Logik wird für die neue Karte **ersetzt** — die alten Signale bleiben intern für Account-Tausch-Vorschläge (Sektion „Account-Tausch") verfügbar, tauchen aber nicht mehr als eigene Downgrade-Karten auf.

### Technische Umsetzung

- **Neues Modul** `src/lib/downgrade-candidates.ts`
  - `buildDowngradeCandidates(ctx): DowngradeSignal[]`
  - Liest: `chatter_history` (Roster + letzter Umsatz/Msgs), `chatter_activity_sessions` (Aktivität), `chatter_incoming_stats` (eingehende Msg-Zahlen), `get_chatter_onboarding` (Onboarding-Tag).
- **Integration** in `src/lib/today-engine.ts` bzw. `revenue-tasks.ts`:
  - Neue Signale werden als `kind: "downgrade"` in den Task-Stream gepusht.
  - Die bisherige Downgrade-Erzeugung in `account-swap-engine.ts` (Zeilen ~880–908) wird auf `kind: "swap-support"` umgeschrieben oder unterdrückt, damit keine doppelten Karten entstehen.
- **UI** in `src/pages/Today.tsx`:
  - Der bestehende `KIND_DEFS`-Eintrag `downgrade` (Zeile 66) bleibt — nur die Datenquelle wechselt.
  - Farbton bleibt rot; Icon `TrendingDown`.
- **Kein DB-Schemawechsel** nötig — alle Tabellen existieren.

### Verifikation
- Typcheck grün.
- Screenshot der „Heute"-Seite (Desktop + 440 px Mobile), der die neue Karte mit ≥ 1 Kandidat je Bucket zeigt.
- Warum-Text ist auf Mobile vollständig lesbar (kein `truncate`).
