/**
 * Robustes Matching zwischen Live-Namen (aus der Echtzeit-Quelle) und den
 * kanonischen Chatter-Namen aus dem aktuellsten Report ("Roster").
 *
 * Hintergrund: Die Live-Quelle liefert oft eine Kurz-/Abweichform des Namens
 * ("Joshua Krewer", "isabell_ho", "Tim Perfölz"), während der Report den
 * kanonischen Namen führt ("Joshua Noel Krewer", "Isabell Hollweg",
 * "Tim Perfoelz"). Ohne Auflösung fällt die Zeile in der UI raus — und damit
 * verschwindet der Verzug (ältester unbeantworteter Chat) komplett.
 *
 * Grundsatz: lieber NICHT matchen als falsch matchen. Jede Zuordnung muss
 * eindeutig sein (in beide Richtungen), sonst bleibt der Name unverändert.
 */

function fold(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\uFE00-\uFE0F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(s: string): string[] {
  const f = fold(s);
  return f ? f.split(" ") : [];
}

export function nameKey(s: string): string {
  return fold(s);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort().join(" ");
  const y = [...b].sort().join(" ");
  return x === y;
}

function prefixEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function editDistance1(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 4) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
    if (diff > 1) return false;
  }
  return diff === 1;
}

/**
 * Tier: 0 = exakt, 1 = Vor- und Nachname passen (Prefix/Zusatz-Mittelnamen),
 * 2/2.5 = Einzelname eindeutig, 3 = Tippfehler im Nachnamen. -1 = kein Match.
 */
function matchTier(live: string[], roster: string[]): number {
  if (live.length === 0 || roster.length === 0) return -1;
  if (live.join(" ") === roster.join(" ")) return 0;
  if (sameSet(live, roster)) return 0;

  const lf = live[0];
  const ll = live[live.length - 1];
  const rf = roster[0];
  const rl = roster[roster.length - 1];

  if (live.length > 1 && roster.length > 1) {
    if (prefixEq(lf, rf) && prefixEq(ll, rl)) return 1;
    if (lf === rf && editDistance1(ll, rl)) return 3;
    return -1;
  }
  // Eine Seite hat nur einen Token → nur über den Vornamen matchbar.
  if (lf === rf) return 2;
  if (prefixEq(lf, rf)) return 2.5;
  return -1;
}

/**
 * Baut eine Zuordnung live-Name → kanonischer Roster-Name.
 * Nur eindeutige Treffer werden übernommen.
 */
export function buildNameResolver(
  rosterNames: string[],
  liveNames: string[],
): Map<string, string> {
  const roster = rosterNames
    .map((n) => ({ raw: n.trim(), t: tokens(n) }))
    .filter((r) => r.t.length > 0);
  const rosterKeys = new Set(roster.map((r) => r.t.join(" ")));

  // live key → { roster raw, tier }
  const best = new Map<string, { target: string; tier: number }>();

  for (const rawLive of liveNames) {
    const lt = tokens(rawLive);
    if (lt.length === 0) continue;
    const key = lt.join(" ");
    if (rosterKeys.has(key)) continue; // exakt vorhanden, nichts umzubenennen

    let bestTier = 99;
    let candidates: string[] = [];
    for (const r of roster) {
      const tier = matchTier(lt, r.t);
      if (tier < 0) continue;
      if (tier < bestTier) {
        bestTier = tier;
        candidates = [r.raw];
      } else if (tier === bestTier) {
        candidates.push(r.raw);
      }
    }
    if (candidates.length !== 1) continue; // mehrdeutig → nicht anfassen
    best.set(key, { target: candidates[0], tier: bestTier });
  }

  // Rückrichtung: zwei Live-Namen dürfen nicht auf denselben Roster-Namen zeigen.
  const byTarget = new Map<string, { key: string; tier: number }[]>();
  for (const [key, v] of best) {
    if (!byTarget.has(v.target)) byTarget.set(v.target, []);
    byTarget.get(v.target)!.push({ key, tier: v.tier });
  }

  const out = new Map<string, string>();
  for (const [target, list] of byTarget) {
    if (list.length === 1) {
      out.set(list[0].key, target);
      continue;
    }
    const minTier = Math.min(...list.map((l) => l.tier));
    const winners = list.filter((l) => l.tier === minTier);
    if (winners.length === 1) out.set(winners[0].key, target);
    // sonst: alle verwerfen
  }
  return out;
}

/** Wendet den Resolver auf einen Namen an. */
export function resolveName(resolver: Map<string, string>, name: string): string {
  const key = tokens(name).join(" ");
  return resolver.get(key) ?? name.trim();
}
