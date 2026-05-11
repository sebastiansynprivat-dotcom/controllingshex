## Ziel

Talent-Logik komplett neu denken: weg von „Aufsteiger erfüllt Schwellen X/Y/Z", hin zu **„Wer arbeitet kontinuierlich? Wo wird ein Account vernachlässigt? → Paaren."**

Schwellen-UI fliegt raus. Die Logik soll von alleine das Richtige finden.

---

## Neue Kernidee

Es gibt zwei Ranglisten — **kein Filter, sondern Sortierung**:

1. **Workhorses** — Chatter, die jeden Tag verlässlich da sind und arbeiten (egal wie lange schon onboarded). Ranking nach Kontinuität, nicht nach absoluter Performance.
2. **Verwaiste Accounts** — Accounts/Chatter-Account-Kombis, auf denen aktuell zu wenig passiert (wenig Aktivitätstage, viele offene Chats, hoher Verzug, Umsatz weit unter dem, was der Account könnte).

Dann: Top-Workhorses werden Top-verwaisten-Accounts zugeordnet, sortiert nach **erwartetem Wirkungs-Zuwachs** (großer Account × kontinuierlicher Arbeiter = oben).

---

## Workhorse-Score (pro Chatter, 7T-Fenster)

Was zählt:

- **Anwesenheit**: Anteil Tage in den letzten 7T mit *irgendeiner* Aktivität (Revenue > 0 ODER MassDM > 0 ODER Session vorhanden). Wert 0…1.
- **Kontinuität / Streak**: längste zusammenhängende Strecke aktiver Tage in den 7T. Belohnt „jeden Tag dran" stärker als „4 Tage am Stück, dann 3 Tage weg".
- **Onboarding-Bonus**: Chatter mit `daysOnboarded` zwischen 5–45 Tagen bekommen einen kleinen Bonus (+15 %). Frische Leute, die liefern, sind genau das, was wir suchen — aber Veteranen, die ebenfalls jeden Tag da sind, dürfen auch reinrutschen.
- **Kein** Mindestwert für MassDMs/Sessions/Konsistenz. Niedrige Aktivität auf einem Mini-Account drückt den Score nicht — wir bewerten Verlässlichkeit, nicht Volumen.

Score grob: `Anwesenheit × 50 + (Streak/7) × 35 + Onboarding-Bonus`.

Auflistung: Top-N (z. B. 12) Workhorses.

---

## Verwaister-Account-Score

Pro aktivem Chatter-Account-Paar (jüngster Account je Chatter, 7T-Fenster):

- **Untertage** = 7 − Anzahl aktiver Tage. Je mehr stille Tage, desto schlimmer.
- **Stau** = offene Chats über Pool-Median.
- **Verzug** = Antwort-Verzug in Tagen.
- **Umsatz-Lücke** = wie weit `avgRev` unter dem Tier-Median des Accounts liegt (großer Account, der wenig bringt → hohes Gewicht).
- **Account-Größe** als Multiplier: `top` × 1.4, `growth` × 1.2, `starter` × 1.0, `seed` × 0.7. Ein vernachlässigter Top-Account ist viel teurer als ein vernachlässigter Seed.

Score: `(Untertage × 12 + Stau × 0.5 + Verzug × 20 + Umsatz-Lücke-Faktor × 30) × Tier-Multiplier`.

Damit niemand sofort raus ist: jeder Account mit mind. *einem* Schmerzsignal (Untertag, Verzug ≥ 1, Umsatz < 50 % Tier-Median, Stau über Median) landet im Pool, sortiert nach Score.

---

## Pairing

Greedy:

1. Top-Workhorse nimmt den Top-verwaisten-Account, sofern es **nicht derselbe Chatter** ist und sich der Tier mindestens auf gleichem oder höherem Niveau befindet (Workhorse soll ja idR. *aufsteigen*).
2. Markiere Underuser + Workhorse als verbraucht, weiter mit Nr. 2 vs. Nr. 2, usw.
3. Maximal 8 Vorschläge.

Pair-Score = `0.6 × VerwaistScore + 0.4 × WorkhorseScore`, nur Anzeige.

---

## To-Do-Karten (Anzeige in `/today` „Talent")

Pro Match eine Karte mit:

- 🚀 *„{Workhorse} auf {underuserAccount} hochziehen"*
- Begründung 1 Satz: *„{Workhorse}: {streak} Tage am Stück aktiv, {onboardDays}T onboarded. Account {underuserAccount} ({tier}): zuletzt nur {activeDays}/7 Tage bespielt, Ø {delay}T Verzug, {openChats} offene Chats."*
- compareWith für Wechsel-Modal bleibt.

Zusätzlich: max. 3 **Solo-Warnungen** für besonders verwaiste Accounts ohne passenden Workhorse — *„⚠️ Account {x} liegt brach ({reasonChips})"*.

---

## UI-Änderungen

- `TalentScoutPanel.tsx` wird **komplett gelöscht** (Slider, Schwellen-Anzeige, Druck-Badge, localStorage-Override — alles raus).
- `DailyTodoList.tsx`: Import + Render des Panels entfernen, `reload()` darf bleiben (wird nicht mehr getriggert).
- `talent-scout.ts`: `findTalentMatchesDetailed`, `loadThresholdOverride`, `saveThresholdOverride`, `AdaptiveThresholds`, `TalentDiagnostics`, `ThresholdSource`, `deriveAdaptiveThresholds` werden entfernt. localStorage-Key wird einmalig aufgeräumt (optional). `findTalentMatches(platform)` bleibt als einzige Export-Funktion mit neuer Logik.

---

## Nicht im Scope

- Keine DB-Änderungen, keine neuen Datenquellen.
- Kein neues UI-Panel — die Logik soll ohne Knöpfe Sinn ergeben.
- Onboarding-Definition (≥5 Tage) bleibt nur noch als *Bonus*, nicht als Filter.
