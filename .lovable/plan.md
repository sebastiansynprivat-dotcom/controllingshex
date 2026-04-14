

## Plan: Kategorisierung bullet-proof machen — 0€ Override lückenlos

### Problem
Der Safety-Override in `buildResultFromCsv` hat Lücken. Er fängt nur diese Kategorien ab:
- `POSITIVE_CATEGORIES`: UPGRADE, BREAKOUT, KURZ VOR, COMEBACK
- Regex: WEITER SO / MITTELFELD

**Nicht abgefangen** werden 0€-Chatters in:
- `TOP PERFORMER` (fehlt in POSITIVE_CATEGORIES)
- `ACCOUNT UPGRADE (ZUVERLÄSSIG)` (fehlt)
- `VIDEO-COACHING`, `COACHING / ENGERE KONTROLLE`
- `HOHER TRAFFIC / KEINE CONVERSION`
- `UNTER BEOBACHTUNG`
- Jede andere Kategorie, die die KI erfindet

### Lösung: Whitelist-Ansatz statt Blacklist

Statt einzelne "verbotene" Kategorien aufzulisten, wird die Logik umgedreht: **Nur explizit erlaubte Kategorien dürfen bei 0€ bleiben.** Alles andere wird überschrieben.

Erlaubte Kategorien bei 0€ Tagesumsatz:
- `ONBOARDING TAG X` (1-5)
- `WARNUNG`
- `0€ UMSATZ TAG X` (bereits korrekt)
- `ACCOUNT-EINBRUCH` (nur mit History-Beweis ≥ 20€ Ø)
- `HOHER TRAFFIC / KEINE CONVERSION` (0€ ist Teil der Definition)

Alles andere bei 0€ → Override zu `0€ UMSATZ TAG X`.

Zusätzlich: `Gesamtumsatz` als KPI hinzufügen (fehlt aktuell).

### Dateien

| Datei | Änderung |
|---|---|
| `src/pages/Upload.tsx` | `buildResultFromCsv`: Whitelist statt Blacklist. Nur erlaubte Kategorien dürfen bei 0€ bestehen bleiben. `Gesamtumsatz` KPI aus chatter_history laden und anzeigen. |

### Technisches Detail

```text
VORHER (Blacklist):
  if (revenueToday === 0)
    if (POSITIVE_CATEGORIES.has(cat) || /WEITER SO/.test(cat))
      → override

NACHHER (Whitelist):
  if (revenueToday === 0)
    if (!ALLOWED_ZERO_CATEGORIES.has(cat))  // ONBOARDING, WARNUNG, 0€ TAG, TRAFFIC, EINBRUCH(mit Beweis)
      → override zu 0€ UMSATZ TAG X
```

Eine Datei, eine Änderung — schließt alle Lücken.

