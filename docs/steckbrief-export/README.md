# Steckbrief-Export: Controlling → ChatAI

Ziel: Das Team pflegt nur noch im Controlling, welcher Steckbrief (SheX-Coaching-Model) zu einem
Plattform-Konto gehört. ChatAI bekommt je Konto den freigegebenen Steckbrief über einen eigenen
Export. Die Inhalte bleiben in SheX Coaching, das Controlling speichert keine Steckbrief-Texte.

- Verträge (verbindlich): [`vertraege.md`](./vertraege.md)
- Übergabe an ChatAI: [`chatai-uebergabe.md`](./chatai-uebergabe.md)

## Wie ein Konto seinen Steckbrief bekommt

Rangfolge je Konto (Plattform + Login-Mail):

1. **Ausnahme im Controlling**: ein Model zugeordnet oder „kein Steckbrief“.
2. **SheX-Konto**: SheX Coaching kennt genau diese Plattform mit genau dieser Login-Mail.
3. **Gleiche Login-Mail**: dieselbe Mail führt auf einer anderen Plattform zu genau einem Model.
4. Sonst: kein Steckbrief. ChatAI schaltet das Konto dann nicht zum Senden frei.

Was SheX schon kennt, braucht keine Handarbeit. Gepflegt werden nur Ausnahmen, auf der Seite
„Models & Follower“ direkt an jedem Konto. Stand 24.09. betraf das etwa 86 Konten, deren Login-Mail
SheX gar nicht kennt, davon 61 auf 4Based.

## Bausteine

| Baustein | Ort |
|---|---|
| Tabelle `model_steckbrief_links` (nur Ausnahmen, RLS nur Admin) | `supabase/migrations/20260924190000_model_steckbrief_links.sql` |
| Export für ChatAI `models-steckbrief-export` (nur `x-api-key`) | `supabase/functions/models-steckbrief-export/` |
| Übersicht für die Oberfläche `steckbrief-links` (Login + Admin-Rolle) | `supabase/functions/steckbrief-links/` |
| Gemeinsamer Kern (Rangfolge, Status, Kürzung, SheX-Client) | `supabase/functions/_shared/steckbrief/` |
| Oberfläche | `src/components/SteckbriefPanel.tsx`, `src/lib/steckbrief-links.ts`, `src/pages/Models.tsx` |
| Lese-Endpunkt in SheX Coaching `controlling-model-profiles` | Repository gold-reveal-next; Patch und Anleitung in [`shex-coaching/`](./shex-coaching/README.md) |

`models-export` bleibt unverändert.

## Inbetriebnahme (Lovable, etwa 20 Minuten)

Die Reihenfolge ist wichtig. Solange ein Schritt fehlt, antworten die neuen Endpunkte mit
`503 not_configured`, und die Models-Seite zeigt nur einen Hinweis. Kaputt geht dabei nichts.

1. **SheX Coaching**:
   - Den Patch aus [`shex-coaching/`](./shex-coaching/README.md) in gold-reveal-next anwenden und nach
     `main` bringen.
   - Im Lovable-Projekt das Secret `CONTROLLING_MODEL_PROFILES_KEY` setzen. Der Wert steht lokal in
     `~/.shex-secrets/controlling-model-profiles.env`.
2. **Controlling**:
   - Den PR mergen.
   - In Lovable die Migration `20260924190000_model_steckbrief_links.sql` anwenden.
   - Zwei Secrets setzen:
     - `STECKBRIEF_EXPORT_KEY` aus `~/.shex-secrets/steckbrief-export.env`
     - `CONTROLLING_MODEL_PROFILES_KEY`, derselbe Wert wie in Schritt 1
3. **Admin-Rolle** für die Logins, denen die Konten gehören. Im Lovable-SQL-Editor:

   ```sql
   -- Wem gehören die Konten, und wer ist schon Admin?
   select m.user_id, u.email, count(*) as konten, public.has_role(m.user_id, 'admin') as ist_admin
   from public.models m left join auth.users u on u.id = m.user_id
   group by 1, 2 order by konten desc;

   -- Admin-Rolle für die echten Team-Logins setzen (Mail-Adressen eintragen):
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email in ('<team-login@…>')
   on conflict (user_id, role) do nothing;
   ```

   Nur Konten mit Admin-Besitzer erscheinen im Export. Alle anderen zählen als `excluded_rows`.
   So kann eine fremd angelegte Zeile nie einen echten Steckbrief erben.
4. **Prüfen**:
   - Models-Seite öffnen: Jedes Konto zeigt einen Steckbrief-Chip.
   - Der Filter „Ohne freigegebenen Steckbrief“ zeigt die offenen Fälle.
   - Den Export ohne Schlüsselausgabe aufrufen:

   ```bash
   set -a; . ~/.shex-secrets/steckbrief-export.env; set +a
   curl -s -H "x-api-key: $STECKBRIEF_EXPORT_KEY" "$STECKBRIEF_EXPORT_URL" \
     | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("contract"), d.get("summary"))'
   ```

   Erwartung: `approved` liegt deutlich über 532 (Stand 24.09. über den alten Lookup), weil die Regel
   „gleiche Login-Mail“ greift. `excluded_rows` sollte 0 sein.

## Sicherheit

- **Export**: nur Header `x-api-key` mit einem eigenen Schlüssel, keine CORS-Header,
  `cache-control: no-store`. Es gibt keinen Zugang über einen App-Login.
- **Ausnahmen und Übersicht**: nur mit Admin-Rolle, abgesichert per RLS und Rollenprüfung.
- **Logs**: nur Zähler und Dauer, keine Mails, IDs oder Inhalte.
- **Offen, außerhalb dieses Vorhabens**:
  - Die Registrierung im Controlling ist offen (`disable_signup=false`, Auto-Bestätigung an).
  - `models-export` akzeptiert jedes gültige App-Login.
  - Empfehlung: In Lovable Cloud neue Registrierungen abschalten und
    `select email, created_at from auth.users order by created_at desc` auf fremde Konten prüfen.
