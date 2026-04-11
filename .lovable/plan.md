

## Chatter-Entwicklungsgraph (30 Tage)

### Was wird gebaut
Im `ChatterSlideOver` wird oberhalb des bestehenden Umsatzverlauf-Charts ein neuer **30-Tage-Trend-Block** eingefügt mit:
- Einem kompakten **Area-Chart** der letzten 30 Tage Umsatz
- Einer **Trend-Anzeige** (↑ / ↓ / →) mit prozentualem Vergleich (letzte 15 Tage vs. vorherige 15 Tage)
- Farbcodierung: Grün bei positivem Trend, Rot bei negativem, Neutral bei stabil

### Änderungen

**`src/components/ChatterSlideOver.tsx`**
- Neues `useMemo` für `last30Days`: die letzten 30 Einträge aus `history` filtern
- Neues `useMemo` für `trend30`: Vergleich Durchschnittsumsatz erste Hälfte vs. zweite Hälfte → Prozent-Differenz + Richtung
- Neuer UI-Block zwischen KPI-Grid und bestehendem Umsatzverlauf:
  - Überschrift "30-Tage-Trend"
  - Kompakter AreaChart (Höhe 140px) mit Gradient-Fill (grün/rot je nach Trend)
  - Trend-Badge rechts oben: z.B. "↑ +12%" in Grün oder "↓ -8%" in Rot
- Der bestehende "Umsatzverlauf"-Chart bleibt unverändert als Gesamthistorie

### Keine DB-Änderung nötig
Die Daten kommen aus dem bereits geladenen `history`-Array.

