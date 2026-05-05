CREATE OR REPLACE FUNCTION public.recompute_live_now()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TEMP TABLE _live_filtered ON COMMIT DROP AS
  WITH user_window AS (
    SELECT s.user_id,
      GREATEST(5, LEAST(180, COALESCE(NULLIF(s.value,'')::int, 15))) AS win_min
    FROM public.settings s
    WHERE s.key = 'live_now_window_min'
  )
  SELECT
    h.user_id,
    h.platform,
    lower(h.chatter_name) AS key,
    h.chatter_name
  FROM public.chatter_hourly_stats h
  LEFT JOIN user_window u ON u.user_id = h.user_id
  WHERE h.chatter_name IS NOT NULL
    AND h.chatter_name <> ''
    AND (COALESCE(h.revenue,0) > 0 OR COALESCE(h.mass_dms,0) > 0 OR COALESCE(h.unread_delta,0) < 0)
    AND h.updated_at >= now() - make_interval(mins => COALESCE(u.win_min, 15));

  INSERT INTO public.live_now_counts (user_id, platform, count, chatter_names, computed_at)
  SELECT user_id, platform, COUNT(DISTINCT key), ARRAY_AGG(DISTINCT chatter_name), now()
  FROM _live_filtered
  GROUP BY user_id, platform
  ON CONFLICT (user_id, platform) DO UPDATE
    SET count = EXCLUDED.count,
        chatter_names = EXCLUDED.chatter_names,
        computed_at = EXCLUDED.computed_at;

  UPDATE public.live_now_counts l
  SET count = 0, chatter_names = '{}', computed_at = now()
  WHERE NOT EXISTS (
    SELECT 1 FROM _live_filtered f
    WHERE f.user_id = l.user_id AND f.platform = l.platform
  )
  AND l.count <> 0;

  DROP TABLE _live_filtered;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_live_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_live_now() TO service_role, postgres;

SELECT public.recompute_live_now();