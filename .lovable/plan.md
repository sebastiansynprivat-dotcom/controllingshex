

## Farbcodierte Alerts / Notifications

### Was wird gebaut
Ein Alert-Banner-Bereich direkt unter der Suchleiste und über dem TrendWidget im Dashboard. Die Alerts werden automatisch aus den Analysedaten berechnet und zeigen die kritischsten Probleme auf einen Blick — farblich codiert nach Dringlichkeit.

### Alert-Regeln (automatisch berechnet aus `result.categories`)

| Farbe | Priorität | Regel | Beispiel |
|-------|-----------|-------|----------|
| **Rot** | Kritisch | Chatters mit Verzug > 3 Tage (Kategorie "WARNUNG") | "🟠 3 Chatters mit Antwortverzug > 3 Tage" |
| **Rot** | Kritisch | Chatters in "0€ UMSATZ TAG 5" bis "TAG 7+" | "📉 2 Chatters mit 0€ seit 5+ Tagen" |
| **Orange** | Warnung | Chatters in "ACCOUNT-EINBRUCH" | "⚠️ 1 Account mit Umsatzeinbruch" |
| **Orange** | Warnung | Chatters in "COACHING / ENGERE KONTROLLE" | "🟡 4 Chatters brauchen engere Kontrolle" |
| **Blau** | Info | Neue Onboarding-Chatters (TAG 1-2) | "🔵 2 neue Chatters im Onboarding" |
| **Grün** | Positiv | Chatters mit Upgrade/Breakout | "🟢 3 Chatters im Upgrade-Streak" |

### UI-Design
- Horizontal gestapelte Alert-Karten, jeweils mit farbigem Rand links (4px)
- Hintergrund leicht getönt passend zur Farbe (z.B. `bg-red-500/5`, `border-l-red-500`)
- Klickbar: Bei Klick wird zur entsprechenden Kategorie gescrollt
- Nur angezeigt wenn Alerts vorhanden (kein leerer Container)
- Alerts sortiert nach Priorität: Rot → Orange → Blau → Grün
- Kompakt: max. 2 Zeilen, bei mehr als 4 Alerts wird ein "Mehr anzeigen"-Toggle eingeblendet

### Technischer Ansatz

**Einzige Datei: `src/pages/Dashboard.tsx`**
- Neuer `useMemo`-Hook `alerts` der aus `result.categories` die Alert-Regeln berechnet
- Zählt Chatters pro relevanter Kategorie und generiert Alert-Objekte mit `{ color, icon, message, categoryName }`
- Neuer `<DashboardAlerts>` Inline-Bereich zwischen Suchleiste und TrendWidget
- Bei Klick auf einen Alert: `scrollIntoView` zur Kategorie-Karte (via `data-category-name` Attribut, muss in `CategoryResultCards.tsx` ergänzt werden)

**Kleine Änderung: `src/components/CategoryResultCards.tsx`**
- `data-category-name` Attribut an die Kategorie-Container hängen (für Scroll-Target)

### Dateien
1. **`src/pages/Dashboard.tsx`** — Alert-Berechnung + Rendering
2. **`src/components/CategoryResultCards.tsx`** — `data-category-name` Attribut ergänzen

