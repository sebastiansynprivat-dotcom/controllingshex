-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Table
CREATE TABLE IF NOT EXISTS public.live_now_counts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  count INTEGER NOT NULL DEFAULT 0,
  chatter_names TEXT[] NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform)
);

ALTER TABLE public.live_now_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own live counts"
ON public.live_now_counts
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role full access live_now_counts"
ON public.live_now_counts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Realtime
ALTER TABLE public.live_now_counts REPLICA IDENTITY FULL;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='live_now_counts';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.live_now_counts';
  END IF;
END $$;

-- Recompute function
CREATE OR REPLACE FUNCTION public.recompute_live_now()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH active AS (
    SELECT
      user_id,
      platform,
      lower(chatter_name) AS key,
      chatter_name
    FROM public.chatter_hourly_stats
    WHERE updated_at >= now() - interval '15 minutes'
      AND (
        COALESCE(revenue, 0) > 0
        OR COALESCE(mass_dms, 0) > 0
        OR COALESCE(unread_delta, 0) < 0
      )
      AND chatter_name IS NOT NULL
      AND chatter_name <> ''
  ),
  agg AS (
    SELECT
      user_id,
      platform,
      COUNT(DISTINCT key) AS cnt,
      ARRAY_AGG(DISTINCT chatter_name) AS names
    FROM active
    GROUP BY user_id, platform
  )
  INSERT INTO public.live_now_counts (user_id, platform, count, chatter_names, computed_at)
  SELECT user_id, platform, cnt, names, now() FROM agg
  ON CONFLICT (user_id, platform) DO UPDATE
    SET count = EXCLUDED.count,
        chatter_names = EXCLUDED.chatter_names,
        computed_at = EXCLUDED.computed_at;

  -- Reset rows that no longer have any active chatters
  UPDATE public.live_now_counts l
  SET count = 0, chatter_names = '{}', computed_at = now()
  WHERE NOT EXISTS (
    SELECT 1 FROM public.chatter_hourly_stats s
    WHERE s.user_id = l.user_id
      AND s.platform = l.platform
      AND s.updated_at >= now() - interval '15 minutes'
      AND (COALESCE(s.revenue,0) > 0 OR COALESCE(s.mass_dms,0) > 0 OR COALESCE(s.unread_delta,0) < 0)
  )
  AND l.count <> 0;
END;
$$;

-- Schedule (every minute) — drop existing job first if present
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'recompute-live-now';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  PERFORM cron.schedule('recompute-live-now', '* * * * *', $cron$ SELECT public.recompute_live_now(); $cron$);
END $$;

-- Initial run
SELECT public.recompute_live_now();