## Live-Tracking Fixes

Drei kleine, gezielte Anpassungen — keine Re-Designs.

### 1. „Alle" zeigt wirklich alle

Aktuell: Wenn Filter = `Alle` aktiv ist, landen Chatter mit Score < 40 trotzdem im eingeklappten „laufen sauber"-Bereich. Das verbirgt sie.

Fix: Sobald **explizit** ein Filter gewählt ist (auch `Alle`, sobald Suche aktiv ist oder ein anderer Filter als Default), bekommen alle gefilterten Treffer **eine flache Liste ohne Buckets** und ohne eingeklappten Running-Bucket.

Konkret:
- `Alle` → 3 Buckets bleiben, aber „laufen sauber" wird **standardmäßig aufgeklappt** (statt zu) — sonst sieht man die Mehrheit nicht.
- `Eskalation`, `Lost Potential`, `Inaktiv` → flache Liste, keine Bucket-Trennung, alle Treffer sichtbar.

### 2. Neuer Filter „Inaktiv"

Vierte Pille rechts neben den drei bestehenden. Logik: `secondsSince(updated_at) >= 30 * 60` (kein Update seit ≥ 30 min, basierend auf der bestehenden offline-Schwelle).

### 3. Score-Badge entfernen

Die runde Score-Box rechts in jeder Zeile wird komplett entfernt. Der Score bleibt intern als Sortierkriterium und für die Bucket-Zuordnung — er wird nur **nicht mehr angezeigt**.

Stattdessen rückt das Layout so:
- Name + Hot-Pille + relative Zeit links
- Reasons-Zeile darunter
- Mini-Metriken (Revenue, Ungelesen, Mass-DMs) bleiben — aber rücken **rechtsbündig in die Hauptzeile** als kompakte Kennzahlen-Reihe für bessere Lesbarkeit:

```text
●  Sylvia Ja  · vor 2min                    66€  ·  3 ungelesen  ·  1 dm
   3 Std Stau · 14 ungelesen · −60€
```

Die Mini-Metriken sind dezent (text-white/45, tabular-nums), Hot-Pille bleibt grün.

---

### Was unverändert bleibt

- Score-Berechnung (`live-priority.ts`)
- Bucket-Logik & Sortierung
- KPIs oben, Smart-Banner, Realtime, Datenfluss
- Premium-Karten-Look, Farben pro Bucket

### Files
- `src/pages/LiveTracking.tsx` — Filter erweitern, Visible-Logik, Running-Bucket Default-State, Score-Badge entfernen, Row-Layout umbauen
