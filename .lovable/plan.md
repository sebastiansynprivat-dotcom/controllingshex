

## Label-Filter im Dashboard

Erweitert die bestehenden Kategorie-Filter um einen Label-Filter, der kombiniert funktioniert.

### Was sich ändert

1. **Neuer State `activeLabelFilters`** — ein `Set<string>` mit Label-IDs, analog zu `activeFilters` für Kategorien
2. **Label-Filter-Zeile im Desktop-Filter** — neue Gruppe "Labels" unterhalb der Kategorie-Gruppen mit farbigen Pills für jedes erstellte Label
3. **Label-Filter im Mobile-Dropdown** — Labels als zusätzliche Optionen im bestehenden `<Select>`
4. **Kombinierte Filterlogik** — `visibleCategories` berücksichtigt beide Filter gleichzeitig:
   - Kategorie-Filter: zeigt nur passende Kategorien
   - Label-Filter: zeigt nur Chatter mit dem gewählten Label (filtert innerhalb der Kategorien)
   - Beide aktiv: Schnittmenge (Kategorie UND Label müssen passen)

### Technische Details

**`CategoryResultCards.tsx`:**
- Neuer State: `const [activeLabelFilters, setActiveLabelFilters] = useState<Set<string>>(new Set())`
- `visibleCategories`-Logik erweitern: wenn Label-Filter aktiv, Chatters pro Kategorie filtern nach `chatterLabelsMap`, leere Kategorien ausblenden
- Neue Filter-Gruppe "Labels" im Desktop-Filter-Panel mit farbigen Pills (Farbe aus Label)
- Mobile-Select erweitern um Label-Einträge (mit farbigem Dot)
- "Zurücksetzen" setzt beide Filter zurück
- Label-Filter ist Multi-Select (mehrere Labels gleichzeitig = ODER-Verknüpfung)

