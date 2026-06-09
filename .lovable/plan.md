## Was du willst (zur Bestätigung)

- **Quelle = täglicher Report** (`analysis_reports`). Live-DB-Berechnung nur fürs Echtzeit-Tracking auf den Karten (offene Chats, offen seit).
- **Tag 1–5:** Chatter erscheint **ausschließlich** in der Onboarding-Karte (TAG 1–5). Niemals in Sofort-Eingreifen, Beobachten, Belohnen usw. — auch wenn der AI sie da reinsortiert hat.
- **Tag 6–20:** Chatter bleibt in der AI-Kategorie (Sofort-Eingreifen, Belohnen, …) **und** taucht zusätzlich im Onboarding-Filter (Heute-Tab) auf.
- **Heute-Tab:** dieselbe Logik wie Dashboard, plus Live-Tracking (offene Chats + Alter) auf den Onboarding-Karten.

## Was ich ändere

### 1. Dashboard — zurück auf Report-Quelle, aber mit Day-Lock

- Den Live-Override aus dem letzten Schritt **rückgängig** machen (`Dashboard.tsx` lädt nicht mehr `loadOnboardingChatters`).
- Stattdessen Post-Processing der Report-Kategorien direkt in `CategoryResultCards`:
  1. Onboarding-Tag pro Chatter aus `get_chatter_onboarding` (RPC) laden — derselbe Wert, den der Heute-Tab nutzt.
  2. Für jeden Chatter mit `day ∈ [1, 5]`:
     - Aus **allen** Nicht-Onboarding-Kategorien rauswerfen.
     - In genau eine `ONBOARDING TAG {day}`-Karte einsortieren (auch wenn der Report ihn fälschlich woanders hatte).
  3. Für jeden Chatter mit `day ∈ [6, 20]`:
     - In seiner AI-Kategorie lassen (Sofort-Eingreifen, Belohnen, …).
     - Zusätzlich nichts erzwingen — die Onboarding-Karten TAG 6–20 füllen sich aus dem, was der AI dort eingruppiert hat.
  4. Day > 20 oder kein Datum: unverändert lassen.

### 2. Today-Tab — Onboarding-Filter bleibt wie er ist

- `loadOnboardingChatters` nutzt bereits dieselbe RPC + chatter_history → ist effektiv report-äquivalent (jeder Upload schreibt eine Zeile).
- Live-Anreicherung (offene Chats / offen seit) bleibt.
- Falls der Heute-Tab andere Action-Karten rendert (Sofort-Eingreifen etc.), greift dort dieselbe Day-Lock-Regel — checke beim Bau, ob `LabelCardList`/`PushSection` Chatter aus dem Report ziehen und wende dort dieselbe Tag‑1–5‑Filterung an.

### 3. Action-Categories 15–20

- Bleiben wie zuletzt erweitert (TAG 15–20 in `ALLOWED_CATEGORIES` und `action-categories.ts`), damit die Onboarding-Karten bis Tag 20 existieren.

## Technische Details

- `get_chatter_onboarding(p_platform)` liefert `(chatter_name, onboarded_on)` → `daysSince = today − onboarded_on`.
- Day-Lookup in einer `Map<normalizedName, day>`; Normalisierung via `normalizeChatterName` (existiert in `active-chatters.ts`).
- Day-Lock passiert in `CategoryResultCards` im bestehenden `useMemo`-Postprocessing (Zeilen ~345–384) — sauberer Single‑Point‑of‑Truth.
- Performance: ein RPC-Call pro Mount/Platform-Wechsel, gecached in State.

## Was sich für dich sichtbar ändert

- Im Dashboard verschwinden Tag‑1–5‑Chatter aus „Sofort-Eingreifen / Beobachten / …" und landen garantiert in der passenden „ONBOARDING TAG X"-Karte.
- Tag‑6–20‑Chatter bleiben im Heute-Tab im Onboarding-Filter sichtbar **und** behalten ihre AI-Karte.
- Anzahl und Namen in Heute‑Onboarding und Dashboard‑Onboarding sind dann identisch.
