-- Tabelle: zusammenhängende Aktivitäts-Sessions pro Chatter
CREATE TABLE public.chatter_activity_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'Maloum',
  chatter_name text NOT NULL,
  date date NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 0,
  revenue_in_session numeric NOT NULL DEFAULT 0,
  mass_dms_in_session integer NOT NULL DEFAULT 0,
  incoming_proxy integer NOT NULL DEFAULT 0,
  first_response_min integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name, started_at)
);

CREATE INDEX idx_cas_user_platform_date
  ON public.chatter_activity_sessions (user_id, platform, date);
CREATE INDEX idx_cas_chatter
  ON public.chatter_activity_sessions (user_id, platform, chatter_name, started_at DESC);

ALTER TABLE public.chatter_activity_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access activity_sessions"
  ON public.chatter_activity_sessions FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users can view own activity_sessions"
  ON public.chatter_activity_sessions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activity_sessions"
  ON public.chatter_activity_sessions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activity_sessions"
  ON public.chatter_activity_sessions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own activity_sessions"
  ON public.chatter_activity_sessions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_cas_updated_at
  BEFORE UPDATE ON public.chatter_activity_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auswertung: Live-Effizienz pro Chatter über einen Zeitraum
CREATE OR REPLACE FUNCTION public.get_live_efficiency(
  p_user_id uuid,
  p_platform text,
  p_from date,
  p_to date
)
RETURNS TABLE (
  chatter_name text,
  total_active_min integer,
  total_revenue numeric,
  total_mass_dms integer,
  total_incoming_proxy integer,
  session_count integer,
  active_days integer,
  range_days integer,
  eur_per_active_hour numeric,
  eur_per_incoming numeric,
  first_response_min_p50 numeric,
  session_consistency numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT *
    FROM public.chatter_activity_sessions
    WHERE user_id = p_user_id
      AND lower(platform) = lower(p_platform)
      AND date >= p_from
      AND date <= p_to
  ),
  agg AS (
    SELECT
      chatter_name,
      COALESCE(SUM(duration_min), 0)::int AS total_active_min,
      COALESCE(SUM(revenue_in_session), 0)::numeric AS total_revenue,
      COALESCE(SUM(mass_dms_in_session), 0)::int AS total_mass_dms,
      COALESCE(SUM(incoming_proxy), 0)::int AS total_incoming_proxy,
      COUNT(*)::int AS session_count,
      COUNT(DISTINCT date)::int AS active_days,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY first_response_min)
        FILTER (WHERE first_response_min IS NOT NULL) AS first_response_min_p50
    FROM s
    GROUP BY chatter_name
  )
  SELECT
    a.chatter_name,
    a.total_active_min,
    a.total_revenue,
    a.total_mass_dms,
    a.total_incoming_proxy,
    a.session_count,
    a.active_days,
    GREATEST(1, (p_to - p_from + 1))::int AS range_days,
    CASE WHEN a.total_active_min > 0
      THEN (a.total_revenue / (a.total_active_min::numeric / 60.0))
      ELSE 0 END AS eur_per_active_hour,
    CASE WHEN a.total_incoming_proxy > 0
      THEN (a.total_revenue / a.total_incoming_proxy::numeric)
      ELSE 0 END AS eur_per_incoming,
    a.first_response_min_p50,
    (a.active_days::numeric / GREATEST(1, (p_to - p_from + 1))::numeric) AS session_consistency
  FROM agg a;
$$;