CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.weekly_goal_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  chatter_name text NOT NULL,
  week_key text NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  goal_eur numeric NOT NULL,
  actual_eur numeric NOT NULL DEFAULT 0,
  achieved boolean NOT NULL,
  source text NOT NULL DEFAULT 'auto',
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name, week_key)
);

CREATE INDEX weekly_goal_results_lookup
  ON public.weekly_goal_results (user_id, platform, chatter_name, week_key DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_goal_results TO authenticated;
GRANT ALL ON public.weekly_goal_results TO service_role;

ALTER TABLE public.weekly_goal_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own weekly results"
ON public.weekly_goal_results FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own weekly results"
ON public.weekly_goal_results FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own weekly results"
ON public.weekly_goal_results FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own weekly results"
ON public.weekly_goal_results FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role full access weekly results"
ON public.weekly_goal_results FOR ALL TO service_role
USING (true) WITH CHECK (true);