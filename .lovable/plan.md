

## Zwei getrennte Filter-Dropdowns (Mobile)

Aktuell sind Kategorien und Labels in einem einzigen Dropdown zusammengefasst. Beide werden in zwei separate, visuell getrennte Dropdowns aufgeteilt.

### Änderungen

**`src/components/CategoryResultCards.tsx`** — Mobile-Filter-Bereich (Zeilen ~642-683):

1. **Zwei separate `<Select>`-Dropdowns** nebeneinander in einer Flex-Row:
   - **Dropdown 1 — Kategorien**: Zeigt nur Kategorie-Filter (mit Filter-Icon), wie bisher
   - **Dropdown 2 — Labels**: Zeigt nur Label-Filter (mit farbigen Dots), nur sichtbar wenn Labels existieren

2. **Layout**: `flex gap-2` Container, beide Selects mit `flex-1` für gleiche Breite. Falls keine Labels vorhanden, nimmt der Kategorie-Filter die volle Breite ein.

3. **Eigenständige Steuerung**: Jeder Dropdown steuert nur seinen eigenen Filter-State (`activeFilters` bzw. `activeLabelFilters`), unabhängig voneinander.

