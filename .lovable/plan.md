

## Plan: Swipe Mode flüssiger machen

### Probleme identifiziert

1. **Langsamer Initial Load**: 4 sequenzielle Supabase-Queries (report → history → models → checks) blockieren sich gegenseitig
2. **Zu viele Karten im Stack**: `PREFETCH_CARD_COUNT = 7` — jede Karte rendert ein Recharts-SVG mit `ResponsiveContainer`, das ist teuer
3. **Recharts in jeder Karte**: `ResponsiveContainer` + `AreaChart` pro Karte = massive DOM-Last und Re-Renders
4. **AnimatePresence `mode="popLayout"`**: Erzwingt Layout-Neuberechnung bei jedem Kartenwechsel
5. **Labels/Notes laden bei jedem Kartenwechsel**: 3 Supabase-Queries pro Karte (Labels, Assignments, Notes) — auch wenn Panels geschlossen sind
6. **Kein `layoutId` / kein stabiler Key-Übergang**: Karten-Animationen können flackern

### Änderungen

| Datei | Was |
|---|---|
| `src/pages/TinderMode.tsx` | Queries parallelisieren (`Promise.all`), `PREFETCH_CARD_COUNT` auf 3 reduzieren, Labels/Notes lazy laden (nur wenn Panel offen), `AnimatePresence` mode auf `"wait"` ändern |
| `src/components/SwipeCard.tsx` | Sparkline nur für `isTop`-Karte rendern (Stack-Karten zeigen kein Chart), `will-change: transform` auf Top-Karte setzen für GPU-Beschleunigung |

### Technisches Detail

**1. Parallele Queries beim Load**
```typescript
const [report, checks] = await Promise.all([
  supabase.from("analysis_reports")...,
  supabase.from("daily_chatter_checks")...
]);
// Dann history + models parallel:
const [history, models] = await Promise.all([...]);
```

**2. Stack auf 3 Karten reduzieren**
```typescript
const PREFETCH_CARD_COUNT = 3;
```

**3. Sparkline nur für Top-Karte**
```typescript
{isTop && chatter.revenueHistory?.length > 1 && (
  <div className="h-14 mb-3">
    <ResponsiveContainer>...</ResponsiveContainer>
  </div>
)}
```

**4. Labels/Notes lazy laden**
```typescript
useEffect(() => {
  if (!currentChatterName || (!labelPanel && !notePanel)) return;
  // ... queries nur wenn Panel offen
}, [currentChatterName, labelPanel, notePanel]);
```

**5. GPU-Hint für flüssigere Animationen**
```typescript
style={{ willChange: isTop ? "transform" : "auto" }}
```

