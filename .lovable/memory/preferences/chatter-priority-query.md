---
name: Chatter-Priorität bei Ad-hoc-Fragen
description: Wie Chatter/Account-Fragen priorisiert beantwortet werden (Verzug + viele offene Chats + Account lief mal besser + 0 Umsatz)
type: preference
---

Wenn nach "welcher Chatter ist gerade kritisch / soll ich anfassen" gefragt wird, immer nach dieser Priorität ranken:

1. Chatter sitzt auf einem Account, der **historisch schon mal deutlich besser lief** (bester je gemessener €/Tag vs. aktueller Schnitt)
2. **Verzug** (ältester Chat in Tagen) hoch
3. **Viele offene/ungelesene Chats**
4. **Aktuell 0 € (oder fast kein) Umsatz**

Antwort immer sortiert nach Impact (verlorenes €-Potenzial), oben der größte Hebel.
Datenquellen: `chatter_history_live.stats_details` (Echtzeit pro Model) + `chatter_history` (historische €/Tag pro Account, Account-Listen kommagetrennt aufsplitten).
