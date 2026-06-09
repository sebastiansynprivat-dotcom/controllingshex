## Änderung

In `src/lib/onboarding-filter.ts` den Default `minDays` von `6` auf `1` setzen. Dadurch zeigt der Onboarding-Filter im Heute-Tab auch Chatter aus Tag 1–5 an (gruppiert nach Tag, wie bisher absteigend sortiert).

Alles andere bleibt:
- Maximum weiterhin Tag 20.
- Chatter mit bereits gesetztem System-Label fallen weiter raus.
- Inaktive Chatter (nicht in `loadActiveChatterNames`) bleiben ausgeblendet.

Eine Datei, eine Zeile. Keine UI- oder Schema-Änderung.
