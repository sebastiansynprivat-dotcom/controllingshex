

## Plan: Mobile-Optimierung — Kein Seitwärts-Scrollen + Filter als Dropdown

### Problem
1. Trotz `overflow-x: hidden` kann man auf Mobile noch horizontal wischen — die Filter-Pills in `CategoryResultCards.tsx` haben `overflow-x-auto` und erzeugen eine scrollbare Zone.
2. Die Filter-Pills sind auf Mobile unübersichtlich und nehmen zu viel Platz ein.

### Lösung

**1. Filter-Pills → Dropdown-Select (Mobile)**
- Die horizontale Pill-Leiste (Zeile 433-456 in `CategoryResultCards.tsx`) wird auf Mobile durch ein `<Select>`-Dropdown ersetzt.
- Auf Desktop (ab `sm:`) bleiben die Pills sichtbar wie bisher.
- Das Dropdown zeigt alle Kategorien mit Emoji + Name + Anzahl, mit einer "Alle anzeigen"-Option zum Zurücksetzen.

**2. Overflow-Locks verschärfen**
- In `CategoryResultCards.tsx`: `overflow-x-auto` komplett entfernen, da die Pills auf Mobile nicht mehr horizontal scrollen sollen.
- Alle Container mit potenziell breitem Content bekommen `overflow-hidden` und `w-full max-w-full`.

### Dateien

| Datei | Änderung |
|---|---|
| `src/components/CategoryResultCards.tsx` | Filter-Pills auf Mobile durch `<Select>`-Dropdown ersetzen; `overflow-x-auto` entfernen |
| `src/index.css` | Ggf. zusätzliche `touch-action` Regeln |

### Technische Details
- Verwendung der bestehenden `Select`-Komponente aus `src/components/ui/select.tsx`
- Mobile: Ein einzelnes Dropdown mit allen Kategorien
- Desktop (`sm:` und größer): Bestehende Pill-Buttons bleiben erhalten
- Responsive Umschaltung via `hidden sm:flex` / `flex sm:hidden`

