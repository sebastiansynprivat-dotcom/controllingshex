## Ziel

Auffälligkeiten-Karten werden zu echten **Controlling-Karten**. Der ganze "Nachricht erstellen"-Block fliegt raus, dafür kommen die Daten rein, die du beim Daily-Check wirklich brauchst — und der Chatter-Name ist mit einem Klick kopierbar.

## Was sich pro Karte ändert

```text
┌────────────────────────────────────────────────────────────┐
│ #1 ●  Lara Schmidt    −85 €/Tag    [SEIT 5 TAGEN KRITISCH] │
│        📉 Unter Peer-Schnitt — Ø 23 €/Tag vs. 142 € peer    │
│        [maloum_lara] [onlyfans_lara] · 2 Acc · 14.2k Foll.  │
│                                                             │
│        Ø 23 €/Tag    −38 % vs. Vorperiode    4× 0 €-Tage    │
│                                                             │
│        Letzter Check: vor 3 Tagen · Letzte Notiz: 12.04.    │
│        Letztes Coaching: vor 9 Tagen                        │
└────────────────────────────────────────────────────────────┘
```

- **Klick auf Name** → Name in Zwischenablage, dezenter Toast „Lara Schmidt kopiert".
- **Doppelklick irgendwo auf der Karte** → Profil-SlideOver öffnet sich (wie bisher der Profil-Button).
- **✓-Button rechts** bleibt (abhaken bis nächster Report).
- **Untere Action-Bar (Nachricht / Profil) fällt komplett weg.** Karte wird kompakter und ruhiger.

## Drei neue Info-Blöcke

### 1. Status-Historie als Pill (oben rechts neben Impact)
„Seit 5 Tagen kritisch" / „Neu heute" / „Seit 12 Tagen auffällig" — gerechnet aus `chatter_category_state.since_date` (falls vorhanden) oder fallback aus den letzten 30 Tagen `anomaly_alerts`-Einträgen für diesen Chatter+Platform.

### 2. Zahlen-Trio als kleine Stat-Row
Drei Zahlen mit Mini-Label, in einer Zeile, tabular-nums:
- **Ø Umsatz/Tag** im aktuellen Fenster (aus `chatter_history.revenue_today` im Zeitraum).
- **Δ vs. Vorperiode** in % (gleiche Fensterlänge davor).
- **0 €-Tage** im aktuellen Fenster (Anzahl Tage mit `revenue_today = 0` während aktiver Tage).

Trio steht klein zwischen Headline und Footer-Zeile, klar visuell von der bestehenden Headline getrennt durch eine 1-px Trennlinie.

### 3. Letzte-Aktivität-Zeile
Eine kompakte Zeile mit drei Mini-Items, je nur sichtbar wenn vorhanden:
- **Letzter Check** — neuester Eintrag aus `daily_chatter_checks` für diesen Chatter (relativ: „vor 3 Tagen", grün wenn ≤1 Tag, gelb wenn ≤7 Tage, rot wenn älter/nie).
- **Letzte Notiz** — neuester Eintrag aus `coaching_notes` (Datum dd.mm., Hover zeigt Snippet).
- **Letztes Coaching** — neuester Eintrag aus `video_coachings` (relativ).

Keine zusätzlichen Klicks nötig — Info nur sichtbar.

## Datenbeschaffung (eine Query mehr beim Refresh)

Im bestehenden `refresh()` in `AnomalyPanel.tsx` wird `Promise.all` um 4 Queries erweitert (alle gefiltert auf die kritischen Chatter-Namen, die aus dem ersten Anomaly-Pass bekannt sind — also kein Massen-Fetch):

1. `daily_chatter_checks` → letzter `check_date` pro Chatter.
2. `coaching_notes` → letzter `created_at` + `note_text` pro Chatter.
3. `video_coachings` → letzter `sent_at` pro Chatter.
4. `chatter_category_state` → `since_date` für Chatter, deren `current_category` "kritisch"-artig ist.

Die `chatter_history`-Daten für das Zahlen-Trio sind bereits im Memory aus `computeAnomaliesForWindow` — falls nicht, wird zusätzlich der Vorperioden-Slice (`from - windowDays` bis `from - 1`) gefetcht und pro Chatter aggregiert.

Alle Maps werden zusammen mit dem bestehenden Snapshot in `sessionStorage` gecached, damit Tab-Wechsel weiterhin instant ist.

## Komponenten-Änderungen

**`src/components/AnomalyPanel.tsx`**
- Imports: `MessageSquareText`, `ArrowRight`, `buildChatterMessage`, `actionLabelFor` raus. `Copy` bleibt (für Hover-Indikator).
- States raus: `openCards`, `toggleCard`, `copyMessage` (Message-Copy). Stattdessen `copyName(name)`.
- States rein: `lastCheckMap`, `lastNoteMap`, `lastCoachingMap`, `categorySinceMap`, `prevWindowStatsMap`, `currentWindowStatsMap`.
- `refresh()`: zusätzliche Queries + Aggregationen, danach in Snapshot persistieren.
- Render der Karte:
  - Name-Button: `onClick = copyName`, `onDoubleClick = onChatterSelect` (Profil-SlideOver). Visuell minimal anders (Cursor-Hint via `cursor-copy`, Tooltip „Klick = kopieren · Doppelklick = Profil").
  - Status-Pill rechts oben (rendert nur wenn `daysInState >= 1`).
  - Zahlen-Trio-Row direkt unter Headline.
  - Footer-Zeile mit den 3 Aktivitäts-Items, je mit Mini-Icon und relativem Datum.
- Komplett raus: `{/* Action-Bar */}`-Block (Z. 642–670) und der `{/* Aufklappbarer Coaching-Block */}` (Z. 672–746).
- `import AnomalyDetailModal` und `detailAnomaly`-State bleiben unangetastet (nicht im Scope).

**`src/lib/anomaly-window.ts`** — falls nicht schon vorhanden: Helper `daysAgo(dateLike)` exportieren (sonst inline in der Komponente).

## Außerhalb des Scopes

- Keine Änderung an Severity-Berechnung, Dismissal-Sync, Header-Progress-Bar.
- Keine Änderung an `Anomalies.tsx` (Page) selbst — nur die Karten ändern sich, weil sie im Panel leben.
- "Nachricht-erstellen"-Funktion auf der Swipe-/Tinder-Page bleibt erhalten (separater Code-Pfad).

## Reihenfolge der Implementierung

```text
1. Action-Bar + Coaching-Block aus AnomalyPanel löschen (Cleanup zuerst)
2. copyName-Handler + Klick/Doppelklick auf Name verdrahten
3. Refresh um die 4 zusätzlichen Queries erweitern + Maps ins State + Snapshot
4. Zahlen-Trio-Row unter Headline rendern
5. Status-Pill + Letzte-Aktivität-Footer-Zeile rendern
6. Stilistischer Feinschliff (Trenn-Lines, Spacings, Reduce-Motion respektieren)
```

Nach Freigabe baue ich's in einem Rutsch.