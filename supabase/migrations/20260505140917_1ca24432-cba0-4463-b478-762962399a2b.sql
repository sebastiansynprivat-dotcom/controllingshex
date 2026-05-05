-- Temp table mit kanonischen Namen aus chatter_history
CREATE TEMP TABLE _canon ON COMMIT DROP AS
SELECT DISTINCT ON (lower(platform), lower(btrim(regexp_replace(chatter_name, '\s+', ' ', 'g'))))
  lower(platform) AS plat_key,
  lower(btrim(regexp_replace(chatter_name, '\s+', ' ', 'g'))) AS name_key,
  btrim(regexp_replace(chatter_name, '\s+', ' ', 'g')) AS h_name
FROM public.chatter_history
WHERE chatter_name IS NOT NULL AND chatter_name <> ''
ORDER BY lower(platform), lower(btrim(regexp_replace(chatter_name, '\s+', ' ', 'g'))), analysis_date DESC;

-- Berechne Ziel-Namen für jede Live-Zeile
CREATE TEMP TABLE _proposed ON COMMIT DROP AS
SELECT
  l.id AS live_id,
  l.platform,
  l.date,
  l.chatter_name AS old_name,
  l.revenue,
  l.updated_at,
  COALESCE(c.h_name, initcap(btrim(regexp_replace(l.chatter_name, '\s+', ' ', 'g')))) AS new_name
FROM public.chatter_history_live l
LEFT JOIN _canon c
  ON c.plat_key = lower(l.platform)
 AND c.name_key = lower(btrim(regexp_replace(l.chatter_name, '\s+', ' ', 'g')));

-- Pro (platform, new_name, date): Keeper bestimmen (höchster Umsatz, dann neueste)
CREATE TEMP TABLE _keepers ON COMMIT DROP AS
SELECT DISTINCT ON (platform, new_name, date)
  live_id
FROM _proposed
ORDER BY platform, new_name, date, revenue DESC, updated_at DESC;

-- Lösche alle Nicht-Keeper, die in einer Konfliktgruppe sind (>1 Live-Zeile mit gleichem neuen Namen)
DELETE FROM public.chatter_history_live
WHERE id IN (
  SELECT p.live_id
  FROM _proposed p
  WHERE NOT EXISTS (SELECT 1 FROM _keepers k WHERE k.live_id = p.live_id)
);

-- Wende Rename an
UPDATE public.chatter_history_live l
SET chatter_name = p.new_name
FROM _proposed p
WHERE l.id = p.live_id
  AND l.chatter_name <> p.new_name;

-- Refresh live counts
SELECT public.recompute_live_now();