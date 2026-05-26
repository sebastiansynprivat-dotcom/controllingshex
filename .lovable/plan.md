## Ziel

Unter `/today` einen zweiten Top-Level-Tab **"Model Tracking"** ergänzen, der alle Models einer Plattform mit Chatter, Umsatz-Verlauf und Trend zeigt — plus einen kleinen Alerts-Subtab nur für relevante Models.

## Struktur

```text
/today
├─ Tab: Aktionen   (bestehend)
└─ Tab: Model Tracking  (NEU)
    ├─ Subtab: Übersicht
    └─ Subtab: Alerts
```

Tab-Switch oben auf der Seite (gleicher Stil wie bestehende KindTabs).

## Subtab 1 — Übersicht

**Filter-Leiste oben:**
- `TimeRangeToggle` (bestehende Komponente: Heute / Gestern / 7T / 14T / 30T / Custom)
- Trend-Chips als Multi-Select: ↑ Wachstum · → Stabil · ↓ Rückgang · — Keine Daten
- Suchfeld (Model-Name)
- Sortierung: Umsatz ↓ (default), Trend, Name

**Liste — eine Zeile pro Model:**
- Model-Name + aktueller Chatter (kleinerer Text)
- Mini-Sparkline (tägl. Umsatz im gewählten Zeitraum)
- Gesamt-€ im Zeitraum + Ø/Tag
- Trend-Badge mit %
- Klick → öffnet bestehenden `ModelPerformanceSlideOver`

**Datenquelle:** `chatter_history` (account = Model, revenue_today, chatter_name, analysis_date). Aggregiert pro Tag auf Client-Seite (analog `loadModelTimeline`).

**Models-Pool:** ALLE Models, die jemals in `chatter_history` für die Plattform aufgetaucht sind (kein Cutoff) — auch "tote". Models ohne Datenpunkt im gewählten Zeitraum erscheinen mit Trend = "— Keine Daten" und 0 €.

## Trend-Berechnung

Pro Model im gewählten Zeitraum: lineare Regression (least-squares slope) über **alle vorhandenen Tagespunkte** im Range, normalisiert als %/Tag relativ zum Zeitraum-Schnitt.

- Slope > +5% → **↑ Wachstum**
- Slope zwischen −5% und +5% → **→ Stabil**
- Slope < −5% → **↓ Rückgang**
- <3 Datenpunkte → **— Keine Daten**

Ein Wert wie "+18%" oder "−24%" wird als Badge daneben gezeigt (= prozentuale Veränderung Ende vs. Anfang des Zeitraums laut Regression).

## Subtab 2 — Alerts

Nur **wirtschaftlich relevante** Models, die heute Aufmerksamkeit brauchen. Ein Model qualifiziert sich als "relevant" wenn ALLE gelten:
- Gesamt-Umsatz letzte 30T ≥ Schwelle (Default 100 €, in den Settings konfigurierbar via existierender `settings`-Tabelle, Key `model_tracking_relevance_eur`)
- Mindestens 5 Datenpunkte in den letzten 30T

Alerts (nur für relevante Models):
1. **Im Rückgang** — bestehende `detectModelTroubles()` Logik (Drop seit Chatter-Wechsel ODER letzte 7T < 60% des 30T-Schnitts).
2. **Neuer Chatter ohne Performance** — Chatter-Phase ≤7 Tage alt UND Phasen-Schnitt < 70% des Vorgänger-Schnitts.

Jede Alert-Karte: Model · Chatter · kurzer Grund · Δ% · Klick → `ModelPerformanceSlideOver`.
Counter-Badge am Subtab.

Wording: "im Rückgang" (nie "absäuft") — laut Memory.

## Technische Umsetzung

**Neue Datei:** `src/lib/model-tracking-overview.ts`
- `loadAllModels(platform)` → liefert alle distinct accounts aus `chatter_history`
- `loadOverviewTimelines(platform, from, to, modelNames)` → batched (ein Query mit `IN`), gruppiert clientseitig pro (model, day) wie in `model-tracking.ts`
- `computeTrendSlope(daily): { direction, pct }` mit linearer Regression
- `detectNewChatterUnderperform(timelines)` → liefert Alert-Liste

**Neue Komponente:** `src/components/today/ModelTrackingView.tsx`
- State: `timeRange`, `trendFilters`, `search`, `sort`, `subtab`
- Lädt einmal pro `platform`/`timeRange`-Wechsel
- Rendert Filter-Leiste, Liste, Sparkline-SVG inline (kein Recharts nötig für Mini-Sparkline)

**Neue Komponente:** `src/components/today/ModelAlertsList.tsx`
- Nutzt `detectModelTroubles()` aus `model-tracking.ts` + `detectNewChatterUnderperform()`
- Filtert auf relevante Models (Schwelle)

**Änderung:** `src/pages/Today.tsx`
- Oben Tab-Switch: `Aktionen` | `Model Tracking`
- Bei "Model Tracking" rendert `<ModelTrackingView platform={platform} />`, sonst bestehende Action-Logik
- Slide-Over `selectedModel` State wird gehoben/geteilt

**Keine Schema-Änderungen** nötig — alles aus `chatter_history` + `settings`.

## Out of Scope
- Manuelle Models-Auswahl/Ausblendung (kommt später, falls Pool zu unübersichtlich wird)
- Push-Notifications für Alerts
- Vergleich Models untereinander (eigene Compare-View)
