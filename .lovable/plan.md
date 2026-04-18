

## Was du willst

Im `/swipe` Modus zwei Modi per Toggle:
1. **Swipe-Mode** (aktuell, unverändert) — einzelne Karten durchwischen
2. **Wechsel-Mode** (neu) — Tausch-Vorschläge zwischen zwei Chattern, die auf falschen Models sitzen

## Wechsel-Mode Logik

**Idee**: Ein Chatter performt stark relativ zu seinen Followern (hohe Revenue/Follower-Ratio), sitzt aber auf einem schwachen Model. Ein anderer Chatter sitzt auf einem starken Model, performt dort aber schwach. → Tausch vorschlagen.

**Score-Berechnung pro Chatter**:
- `efficiency = currentAvgRevenue / followers` (Revenue pro Follower)
- Hoch-Effizienz auf Low-Follower-Model = "Underplaced" (verdient Upgrade)
- Niedrig-Effizienz auf High-Follower-Model = "Overplaced" (verschwendet Potenzial)

**Pairing-Algorithmus**:
1. Sortiere Chatter nach Effizienz absteigend
2. Top-Performer auf Low-Follower-Models → "Upgrade-Kandidaten"
3. Bottom-Performer auf High-Follower-Models → "Downgrade-Kandidaten"
4. Pair Top mit Bottom, wo Follower-Differenz signifikant ist (z.B. >2x)
5. Berechne **Swap-Impact**: prognostizierter Revenue-Gain wenn Top-Chatter die Effizienz auf das große Model überträgt

**Sortiere alle Vorschläge nach Impact absteigend.**

## UI

```text
┌─────────────────────────────────────────┐
│  [Swipe-Mode] [Wechsel-Mode]   ← Toggle │
├─────────────────────────────────────────┤
│                                         │
│   ┌──────────┐   ⇄   ┌──────────┐      │
│   │ Chatter A│ TAUSCH│ Chatter B│      │
│   │ Model X  │       │ Model Y  │      │
│   │ 10K Foll │       │ 80K Foll │      │
│   │ 500€/Tag │       │ 800€/Tag │      │
│   │ Eff: 5%  │       │ Eff: 1%  │      │
│   └──────────┘       └──────────┘      │
│                                         │
│   Erwarteter Gain: +2.400€/Tag          │
│                                         │
│   ← wischen für andere Pairings →       │
│                                         │
│   [✗ Verwerfen]  [✓ Genehmigen]         │
└─────────────────────────────────────────┘
```

**Swipe-Verhalten** (gemäß deiner Memory: nur 120px Distanz, keine Velocity):
- **Links wischen auf linker Karte** → ersetzt linken Chatter durch nächst-besten Underplaced-Kandidaten (rechte bleibt fix)
- **Links wischen auf rechter Karte** → ersetzt rechten Chatter durch nächst-besten Overplaced-Kandidaten (linke bleibt fix)
- **Rechts wischen** auf einer Karte → "Tausch genehmigen" (markiert Pair als angenommen)
- **Hoch wischen** → ganzes Pairing verwerfen, nächstes Top-Pairing zeigen

So kannst du frei iterieren: linke Karte fix lassen, rechts durchprobieren, oder umgekehrt.

## Was gebaut wird

**Neue Datei**: `src/lib/swap-suggestions.ts`
- `computeSwapCandidates(chatters, models, history)` → liefert sortierte Liste von `SwapPair[]`
- Jeder `SwapPair` enthält: `left` (underplaced), `right` (overplaced), `expectedGain`, plus Pools `leftAlternatives[]` und `rightAlternatives[]` zum Durchwischen

**Neue Komponente**: `src/components/SwapModeView.tsx`
- Rendert zwei Karten nebeneinander (Desktop) bzw. gestackt (Mobile)
- Eigene Swipe-Handler pro Karte (wiederverwendet Framer-Motion-Logik aus SwipeCard)
- "Genehmigen" → speichert in neuer Tabelle `swap_decisions` (chatter_a, chatter_b, status, created_at)

**Erweitert**: `src/pages/TinderMode.tsx`
- Mode-Toggle oben (`useState<"swipe" | "swap">`)
- Bei `"swap"` rendert `<SwapModeView>` statt der normalen Stack-Logik
- Filter/Kategorien werden im Wechsel-Mode ausgeblendet (irrelevant)

**Datenbank**: neue Tabelle `swap_decisions` mit RLS (workspace-scoped wie deine anderen Tabellen)

## Offene Frage

Eine kurze Klärung zur Effizienz-Formel:

<lov-actions>
<lov-suggestion message="Nutz die einfache Formel: revenue/followers. Tausch wird vorgeschlagen wenn der Underplaced mindestens 3x effizienter ist als der Overplaced UND das Ziel-Model mindestens 2x mehr Follower hat. Bau das so.">Einfache Formel (rev/followers, 3x & 2x Schwellen)</lov-suggestion>
<lov-suggestion message="Nutz statt einfacher revenue/followers eine Benchmark-basierte Formel: vergleiche jeden Chatter gegen den Peer-Benchmark seiner Follower-Klasse (loadBenchmarks gibt's schon). Tausch nur vorschlagen wenn beide signifikant über/unter ihrem Peer-Median sind.">Benchmark-basiert (peer-bm Vergleich)</lov-suggestion>
<lov-suggestion message="Lass mich die Schwellen selbst einstellen: bau ein kleines Settings-Panel im Wechsel-Mode mit Slidern für Mindest-Effizienz-Differenz und Mindest-Follower-Differenz">Mit Settings-Panel (Slider für Schwellen)</lov-suggestion>
</lov-actions>
