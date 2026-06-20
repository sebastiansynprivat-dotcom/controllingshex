## Auffälligkeiten in zwei Kategorien: Probleme vs. Highlights

### Ziel
Die Auffälligkeiten-Seite bekommt oben einen Tab-Toggle mit zwei Modi:
- **Probleme** (Default) — alles wie bisher: peer_underperform, self_revenue_drop, persistent_zero, massdm_low, massdm_zero_no_rev
- **Highlights** — die positiven Signale: Peer-Overperform, Self Revenue Spike, Comeback, High Effort

Gleiche Card-Optik, gleicher Time-Range-Filter, gleiche Klick-Logik (Slide-Over), gleicher "nur Leute aus letztem Report"-Filter und gleiche "Neu am Start"-Badge.

---

### 1. Engine erweitern (`src/lib/anomaly-window.ts`)

Drei neue `AnomalyType`s einführen:

- `peer_overperform` — `avgRevenuePerDay >= expected * 1.5`, expected aus Lernkurve/Peer-Schnitt, mind. 4 Tage aktiv. Severity je nach Delta (`positive`).
- `self_revenue_spike` — Eigene Baseline ≥30€, Fenster ≥50% darüber. Severity `positive`.
- `comeback` — Baseline schwach (`avgRevenue < 30€` bei ≥5 Baselinetagen) UND Fenster stark (`avgRevenuePerDay ≥ 60€` bei ≥3 Tagen). Severity `positive`. Score höher als die anderen Highlights, weil das die spannendste Story ist.

`high_effort_no_rev` existiert bereits — gehört in Highlights statt unten ans Listenende der Probleme.

Severity bleibt für alle Highlights `positive` (Farbschema grün ist schon vorhanden).

Score-Berechnung für Highlights: höher = wichtiger (also nicht `0.5` wie bisher für `high_effort_no_rev`). Sortierung im Highlights-Tab läuft genauso über `score` absteigend.

`ANOMALY_LABELS` um die drei neuen Typen erweitern (Label + Emoji).

Optional sinnvoll: ein Helper `isPositive(type: AnomalyType): boolean` exportieren, damit die UI sauber filtern kann ohne severity-Heuristik.

---

### 2. UI: Tab-Toggle (`src/components/AnomalyPanel.tsx`)

Im Header der Card, links neben dem `TimeRangeToggle`, ein Segmented-Control mit zwei Buttons:

```
[ Probleme · 12 ]   [ Highlights · 4 ]
```

Counts = Anzahl Chatter mit mind. einer Anomaly im jeweiligen Modus, nach allen bestehenden Filtern (aktiver Report, dismissed, Onboarding-Filter).

State: `const [mode, setMode] = useState<"problems" | "highlights">("problems")`.

Liste filtern vor dem Gruppieren nach Chatter:

```ts
const filtered = anomalies.filter(a =>
  mode === "highlights" ? isPositive(a.alert_type) : !isPositive(a.alert_type)
);
```

Alles andere — Gruppierung, Sortierung, "X von Y Chattern", Slide-Over, Dismiss-Logik, Labels, "Neu am Start"-Badge — bleibt identisch.

Empty States separat formulieren:
- Probleme leer: "Alle X Chatter clean ✓" (bestehend)
- Highlights leer: "Noch keine Highlights im Zeitraum — schau auch in 30d"

Persistenz des gewählten Tabs in `sessionStorage` analog zur Time-Range (`anomalies.mode`), Default beim Erststart = `problems`.

---

### 3. Hero/Subtitle (`src/pages/Anomalies.tsx`)

Optional ein zweiter Halbsatz im Subtitle abhängig vom Modus ("…und positiver Aufwärtstrends"). Keine größeren Page-Änderungen nötig — der Toggle lebt in der Card.

---

### 4. Was NICHT angefasst wird

- Dismiss-Tabelle (`alert_dismissals`): bleibt schemagleich, neue `alert_type`-Werte gehen einfach mit rein.
- Action-Estimator (`anomaly-actions.ts`): für Highlights brauchen wir keinen €-Impact; falls aufgerufen → 0 zurückgeben oder Komponente blendet die Pille bei `positive` aus.
- Dashboard-Widget: bleibt vorerst nur Probleme. Falls später gewünscht, dort ein zweites Mini-Widget hinzufügen.

---

### Files

- `src/lib/anomaly-window.ts` — 3 neue Anomaly-Typen, Labels, `isPositive`-Helper
- `src/components/AnomalyPanel.tsx` — Tab-Toggle, Filter, Empty-State, sessionStorage
- `src/pages/Anomalies.tsx` — Subtitle leicht anpassen (optional)
