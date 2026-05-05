CREATE OR REPLACE FUNCTION public.record_live_activity_from_history_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_revenue_delta numeric := 0;
  v_mass_dms_delta integer := 0;
  v_unread_delta integer := 0;
  v_stat_date date := (now() AT TIME ZONE 'UTC')::date;
  v_stat_hour integer := EXTRACT(hour FROM (now() AT TIME ZONE 'UTC'))::integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  v_revenue_delta := GREATEST(0, COALESCE(NEW.revenue, 0) - COALESCE(OLD.revenue, 0));
  v_mass_dms_delta := GREATEST(0, COALESCE(NEW.mass_dms, 0) - COALESCE(OLD.mass_dms, 0));
  v_unread_delta := COALESCE(NEW.unread_chats, 0) - COALESCE(OLD.unread_chats, 0);

  IF v_revenue_delta <= 0 AND v_mass_dms_delta <= 0 AND v_unread_delta >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT h.user_id
  INTO v_user_id
  FROM public.chatter_history h
  WHERE h.user_id IS NOT NULL
    AND lower(h.platform) = lower(COALESCE(NEW.platform, 'Maloum'))
    AND lower(trim(h.chatter_name)) = lower(trim(NEW.chatter_name))
  ORDER BY h.analysis_date DESC, h.created_at DESC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.chatter_hourly_stats (
    user_id,
    platform,
    chatter_name,
    date,
    hour,
    revenue,
    mass_dms,
    unread_delta,
    updates_seen,
    updated_at
  )
  VALUES (
    v_user_id,
    COALESCE(NEW.platform, 'Maloum'),
    NEW.chatter_name,
    v_stat_date,
    v_stat_hour,
    v_revenue_delta,
    v_mass_dms_delta,
    v_unread_delta,
    1,
    now()
  )
  ON CONFLICT (user_id, platform, chatter_name, date, hour)
  DO UPDATE SET
    revenue = public.chatter_hourly_stats.revenue + EXCLUDED.revenue,
    mass_dms = public.chatter_hourly_stats.mass_dms + EXCLUDED.mass_dms,
    unread_delta = public.chatter_hourly_stats.unread_delta + EXCLUDED.unread_delta,
    updates_seen = public.chatter_hourly_stats.updates_seen + 1,
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_live_activity_from_history_live() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_live_activity_from_history_live() TO service_role, postgres;

DROP TRIGGER IF EXISTS trg_record_live_activity_from_history_live ON public.chatter_history_live;
CREATE TRIGGER trg_record_live_activity_from_history_live
AFTER UPDATE OF revenue, mass_dms, unread_chats ON public.chatter_history_live
FOR EACH ROW
EXECUTE FUNCTION public.record_live_activity_from_history_live();