
## Ziel

Nur die **Signal-Rows** in `PersonActionCard` umbauen. Header, KPI rechts oben, Meta-Chips und Footer bleiben unverändert. Es geht darum, dass man pro Signal sofort liest: **was ist das Signal** und **warum feuert es**.

## Was heute nicht funktioniert (lines 425–470)

- Titel ist 11 px **bold uppercase tracking-wider** – schreit visuell, aber ist trotzdem schwer zu lesen (Großbuchstaben + enge Größe).
- "Why"-Meta (`r.meta`) ist 11.5 px `white/55 font-light` – verschwindet auf dem dunklen Glas-Background fast komplett.
- Beide Zeilen sind dicht gestapelt (`gap-1`), kein klares Trennen von "Headline" und "Begründung".
- Alle Rows haben fast die gleiche visuelle Gewichtung; nur die linke Akzentleiste (`w-1`) trennt strong/medium/soft – kaum wahrnehmbar.
- Bei Bundles werden bis zu 4 Rows gezeigt → Karte wird lang, ohne dass Wichtiges hervorsticht.

## Konkrete Änderungen in `src/components/PersonActionCard.tsx` (Block lines 425–470)

**Row-Struktur:**

```
[ Akzent ]  SIGNAL-KIND-PILL · klein         ›
            Signal-Titel (lesbar, normalcase)
            └ kompakte Begründung, 2 Zeilen max
```

1. **Kind-Mini-Pill oben in der Row.** Aus `headlineSignal.kind` / `s.kind` → kurzes Label (`KIND_LABEL[s.kind]` existiert bereits). Style: `text-[9.5px] font-bold uppercase tracking-[0.16em]` in Tone-Farbe, ohne Border, mit Punkt davor. Sagt sofort "Verzug · Recovery · Talent", ohne die Titel-Zeile zu fressen.
2. **Titel neu:** `text-[14px] font-medium text-white/95 leading-[1.25] normalcase` (statt 11 px bold uppercase). Wird der Hauptanker der Row.
3. **Why-Meta neu:** `text-[12.5px] text-white/65 font-normal leading-[1.45] line-clamp-2`. Wenn `r.meta` fehlt, wird die Zeile komplett weggelassen (kein leerer Slot).
4. **Hierarchie zwischen Rows:**
   - Row 0 (strong): voller Card-Background (`bg-black/35`), volle Akzentleiste (`w-1.5 ${tone.insertBar}`), Titel + Why in voller Stärke.
   - Row 1 (medium): `bg-black/20`, Akzentleiste dim (`w-1 ${tone.barDim}`), Titel `text-white/85`, Why `text-white/50`.
   - Row 2+ (soft): kein Background, nur eine 1 px Trennlinie oben, Akzentleiste 1 px in `barDim`, Titel `text-[13px] text-white/70`, Why `text-[12px] text-white/45`. Wirkt wie eine Liste, nicht wie gleichwertige Kacheln.
5. **`MAX_SIGNAL_ROWS` von 4 auf 3** runter. `+ N weitere Signale`-Hinweis bleibt unverändert.
6. **Padding & Spacing:** Row-Padding bleibt `p-4 pr-10`, aber innen `gap-1.5` zwischen Kind-Pill, Titel und Why für klare Treppen-Struktur. Abstand zwischen Rows: `gap-2` → `gap-2.5`.
7. **Chevron rechts:** bleibt, aber dimmer (`text-white/20`, hover `text-white/45`), damit er nicht mit der neuen Titel-Gewichtung konkurriert.

## Was sich **nicht** ändert

- Header / Name / Tone-Pill (lines 322–402)
- KPI rechts oben (€/Wo Impact)
- Meta-Chips (Peak / CoI)
- Footer mit Impact-Button + Action-Buttons
- Datenfluss, Bundle-Logik, `compareWith`-Click, Celebration, Animationen
- `LabelCardList` und alle anderen Karten

## Verify

Nach dem Edit: Login, Today öffnen, eine Karte mit ≥2 Signalen (Bundle) und eine mit 1 Signal + Evidence-Einträgen screenshotten. Test: Auf einen Blick erkennbar – Kind (Verzug/Recovery/…), Titel des Signals, kurze Begründung; die Stärke-Hierarchie (strong → soft) ist visuell klar.
