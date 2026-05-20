## Problem

Der Voice-Memo-Button ist da, aber nur im **inline-Modus** des `ChatterSlideOver` (z.B. wenn das Profil als Karte eingebettet ist). Wenn du den Chatter normal über Live-Tracking/Dashboard öffnest, rendert die Komponente den **zweiten Branch** (ab Zeile ~737 `if (inline) { ... }` returnt, danach folgt der Full-Slideover) — und dort fehlt die Sektion.

## Fix

Den identischen "Voice-Memo"-Block (Button + Audio-Player + Download/Neu) direkt vor das **Management-Logbuch** in der Full-Slideover-Variante einfügen (Zeile ~1446).

State, `generateMemo()`-Funktion und Reset-Effect sind bereits in der Komponente vorhanden → keine Logik-Änderung, nur JSX-Duplikat in passendem Styling (premium-card / gold-text-subtle, wie das umliegende Logbuch).

Keine weiteren Änderungen.
