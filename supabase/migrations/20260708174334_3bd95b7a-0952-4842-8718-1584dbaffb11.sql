CREATE OR REPLACE FUNCTION public._roster_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_name, '')), '[_[:space:]]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_live_for_latest_report(p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_platform IS NULL OR trim(p_platform) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.analysis_reports ar
    WHERE lower(ar.platform) = lower(p_platform)
      AND ar.result_json IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  WITH latest_reports AS (
    SELECT DISTINCT ON (ar.user_id, lower(ar.platform))
      ar.user_id,
      ar.platform,
      ar.result_json
    FROM public.analysis_reports ar
    WHERE lower(ar.platform) = lower(p_platform)
      AND ar.result_json IS NOT NULL
    ORDER BY ar.user_id, lower(ar.platform), ar.analysis_date DESC, ar.created_at DESC
  ), roster AS (
    SELECT DISTINCT
      lower(lr.platform) AS platform_key,
      public._roster_name_key(ch->>'name') AS chatter_key
    FROM latest_reports lr
    CROSS JOIN LATERAL jsonb_array_elements(coalesce((lr.result_json::jsonb)->'categories', '[]'::jsonb)) cat
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(cat->'chatters', '[]'::jsonb)) ch
    WHERE public._roster_name_key(ch->>'name') <> ''
  )
  DELETE FROM public.chatter_history_live l
  WHERE lower(l.platform) = lower(p_platform)
    AND public._roster_name_key(l.chatter_name) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM roster r
      WHERE r.platform_key = lower(l.platform)
        AND r.chatter_key = public._roster_name_key(l.chatter_name)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_stale_live_after_report_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.result_json IS NOT NULL THEN
    PERFORM public.cleanup_stale_live_for_latest_report(NEW.platform);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_stale_live_after_report_change ON public.analysis_reports;
CREATE TRIGGER trg_cleanup_stale_live_after_report_change
AFTER INSERT OR UPDATE OF result_json, platform, analysis_date ON public.analysis_reports
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_stale_live_after_report_change();

DO $$
DECLARE
  p text;
BEGIN
  FOR p IN
    SELECT DISTINCT platform
    FROM public.analysis_reports
    WHERE result_json IS NOT NULL
  LOOP
    PERFORM public.cleanup_stale_live_for_latest_report(p);
  END LOOP;
END;
$$;