
CREATE OR REPLACE FUNCTION public.increment_incoming_stats(
  p_user_id uuid,
  p_platform text,
  p_chatter_name text,
  p_date date,
  p_delta integer,
  p_last_unread integer,
  p_last_revenue numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.chatter_incoming_stats
    (user_id, platform, chatter_name, date, incoming_count, last_unread, last_revenue)
  VALUES
    (p_user_id, p_platform, p_chatter_name, p_date, GREATEST(0, p_delta), p_last_unread, p_last_revenue)
  ON CONFLICT (user_id, platform, chatter_name, date) DO UPDATE
    SET incoming_count = public.chatter_incoming_stats.incoming_count + GREATEST(0, p_delta),
        last_unread = EXCLUDED.last_unread,
        last_revenue = EXCLUDED.last_revenue,
        updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_incoming_stats(uuid, text, text, date, integer, integer, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_incoming_stats(uuid, text, text, date, integer, integer, numeric) TO service_role;
