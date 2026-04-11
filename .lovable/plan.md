

## ChatterSlideOver: Sticky Header + Name kopierbar

### Änderungen in `src/components/ChatterSlideOver.tsx`

**1. Header aus dem Scroll-Container herausnehmen und sticky machen**
- Den Header-Block (Name + X-Button) über den scrollbaren Bereich verschieben
- Fester Header oben, darunter der scrollbare Content
- Backdrop-blur + Border-bottom für visuellen Abschluss

**2. Name per Klick kopierbar**
- onClick auf den Namen: `navigator.clipboard.writeText(displayName)` + kurzer Toast ("Name kopiert")
- Cursor-pointer + dezenter Hover-Effekt als visueller Hinweis

**3. Responsive**
- Funktioniert auf Desktop (520px Panel) und Mobile (volle Breite) gleich

### Keine DB-Änderungen nötig

