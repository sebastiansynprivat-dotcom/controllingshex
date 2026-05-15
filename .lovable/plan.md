## Idee-Brainstorm: Mehr Umsatz aus dem Heute-Dashboard

Statt direkt zu bauen, hier ein priorisierter Katalog. Du pickst, was reinkommt — danach mache ich einen konkreten Bauplan.

---

### A. Outcome-Loop (was bringt jede Aktion wirklich €?)

**A1 — Action-ROI-Tracking**
Bei jedem „Erledigt" snapshotten wir die 24/48/72h danach (Revenue Δ, Recovery-Status, Swap angenommen?). Daraus lernt das Dashboard, welche Aktion-Typen *bei dir* tatsächlich €-Hebel bringen — und sortiert künftige Karten nach **bewiesenem** statt geschätztem ROI.

**A2 — „Hat geholfen?"-Mikro-Feedback**
3 Tage nach Erledigung erscheint die Karte 2 Sekunden nochmal mit ✓/✗. Liefert Trainingsdaten für A1 ohne Aufwand.

**A3 — Wochen-Recap**
Sonntag-Karte: „Diese Woche +X € durch Aktionen — Top-Hebel: Swap Paula↔Tom." Macht den Wert sichtbar, motiviert konsequente Nutzung.

---

### B. Smarter Priorisieren (mehr Treffer pro Aktion)

**B1 — Zeitfenster-Awareness**
Eine Aktion zur falschen Tageszeit verpufft. Wir wissen aus `chatter_hourly_stats` wann jeder Chatter peak ist → Karten kriegen Badge **„Beste Zeit: 14–18 Uhr"** und steigen im Score, wenn das Fenster jetzt offen ist.

**B2 — Confidence-Score auf €-Hebel**
Schätzung basiert auf 7T-Baseline. Bei <5 Datenpunkten oder hoher Varianz: kleines `~` vor der Zahl + grauer Ton. Verhindert, dass du Zeit in Phantom-Hebel investierst.

**B3 — Cost-of-Inaction**
„Wenn heute nichts passiert: −X €/7T Folgekosten." Macht Verzug-Karten dringlicher als positive Karten gleicher €-Höhe.

**B4 — Diminishing-Returns-Drosselung**
Wenn du 3× hintereinander dieselbe Coaching-Karte für Person X erledigt hast und Revenue nicht steigt: Karte wird auf „Beobachten" demoted + Vorschlag „Re-Assignen statt Coachen?".

---

### C. Aktionen → konkretere 1-Click-Hebel

**C1 — Swap-Vorschlag mit Auto-Draft**
Statt „Swap prüfen" → Karte zeigt direkt **„Paula → Account A, Tom → Account B"** mit Schätzung +€/Wo. Ein Klick = Eintrag im Wochenplan, kein Slide-Over.

**C2 — Slot-Vorschlag**
„Verschieben Sara von 10–14 auf 16–20 Uhr — +35 % erwarteter Hebel" basiert auf ihrer eigenen peak-hour-Historie.

**C3 — Mass-DM-Trigger**
Wenn ein Model unter Schwelle fällt aber der zuständige Chatter aktiv ist: Karte „Push 3 Mass-DMs raus" mit Vorlage aus Wissensbasis.

**C4 — Cross-Sell-Detector**
Chatter X performt stark auf Model A, Model B (gleicher Archetyp) ist verwaist → „Probier Chatter X auch auf Model B."

---

### D. Datenquellen, die wir noch zu wenig nutzen

- `chatter_activity_sessions` → echte Anwesenheit + first-response-Zeit pro Chatter (für B1, C2, B4)
- `peer_benchmarks` → „Du bist im 70. Perzentil bei Recovery — Top-Performer macht X anders"
- `model_archetypes` → C4 Cross-Sell
- `recovery_queue` Historie → A1 Outcome-Tracking
- `swap_tracking` Annahme-Quote → welche Swap-Vorschläge du eh nie machst → in den Vorschlägen runtergewichten

---

### Empfehlung als Startpaket

Wenn ich 3 wählen müsste: **A1 (ROI-Tracking)** + **B1 (Zeitfenster)** + **C1 (Swap-Auto-Draft)**. A1 macht das System langfristig schlauer, B1 erhöht Trefferquote sofort, C1 senkt Reibung pro Aktion am meisten.

---

**Frage an dich:** Welche Ideen klingen für dich nach echtem Hebel? Markier die, die rein sollen — dann mache ich daraus einen konkreten Bauplan mit Reihenfolge und Datenquellen.
