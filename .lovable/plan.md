

## Filter visuell aufwerten (Desktop)

### Problem
Die 20+ Kategorie-Filter-Pills sind alle gleichförmig in einer langen, umbrechen Reihe angezeigt — unstrukturiert und schwer zu scannen.

### Lösung
Die Filter visuell in logische Gruppen gliedern und das Design aufwerten:

**1. Gruppierung nach Dringlichkeit**
Die Pills werden in 4 visuelle Gruppen mit dezenten Trennlinien aufgeteilt:
- **Kritisch** (rot-getönt): WARNUNG, 0€ UMSATZ TAG 1-7+
- **Achtung** (orange-getönt): ACCOUNT-EINBRUCH, COACHING/ENGERE KONTROLLE
- **Info** (blau-getönt): ONBOARDING TAG 1-5, MODEL-TAUSCH, VIDEO-COACHING
- **Positiv** (grün-getönt): BREAKOUT-STAR, ACCOUNT UPGRADE, KURZ VOR UPGRADE, WEITER SO

**2. Visuelles Redesign der Pills**
- Jeder Pill bekommt einen subtilen farbigen Punkt (4px dot) passend zur Gruppe statt nur Emoji
- Emoji bleibt, aber der Pill-Hintergrund wird leicht nach Gruppenfarbe getönt (z.B. `bg-red-500/[0.03]` für kritische)
- Aktiver Pill: stärkere Farbe der Gruppe statt einheitliches Primary-Gold
- Leere Kategorien (0 Chatters) werden kompakter dargestellt oder ausgeblendet

**3. Layout-Verbesserung**
- Gruppen werden jeweils in einer eigenen Zeile dargestellt mit einem kleinen Label links (z.B. "Kritisch", "Info")
- Oder: Ein 2-Spalten-Grid auf Desktop für bessere Raumnutzung
- "Alle anzeigen" / "Zurücksetzen" Button wenn ein Filter aktiv ist

### Datei
- `src/components/CategoryResultCards.tsx` — Nur die Desktop-Filter-Sektion (Zeile 475-499) wird umgebaut

### Keine DB-Änderungen nötig

