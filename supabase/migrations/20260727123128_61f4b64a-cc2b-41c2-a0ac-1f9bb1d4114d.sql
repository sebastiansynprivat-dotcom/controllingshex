CREATE TABLE public.daily_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  briefing_date date NOT NULL,
  report_id uuid,
  status text NOT NULL DEFAULT 'pending',
  headline text,
  situation text,
  patterns jsonb NOT NULL DEFAULT '[]'::jsonb,
  quick_wins jsonb NOT NULL DEFAULT '[]'::jsonb,
  structural jsonb NOT NULL DEFAULT '[]'::jsonb,
  goal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_impact_eur numeric NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, briefing_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_briefings TO authenticated;
GRANT ALL ON public.daily_briefings TO service_role;
ALTER TABLE public.daily_briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own briefings" ON public.daily_briefings FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.briefing_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id uuid NOT NULL REFERENCES public.daily_briefings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  chatter_name text,
  account text,
  action_type text NOT NULL DEFAULT 'revenue',
  title text NOT NULL,
  instruction text NOT NULL,
  reasoning text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  impact_eur numeric NOT NULL DEFAULT 0,
  confidence text,
  bucket text NOT NULL DEFAULT 'quick_win',
  status text NOT NULL DEFAULT 'open',
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefing_actions TO authenticated;
GRANT ALL ON public.briefing_actions TO service_role;
ALTER TABLE public.briefing_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own briefing actions" ON public.briefing_actions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.revenue_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  month_key text NOT NULL,
  goal_eur numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, month_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_goals TO authenticated;
GRANT ALL ON public.revenue_goals TO service_role;
ALTER TABLE public.revenue_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own revenue goals" ON public.revenue_goals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_daily_briefings_lookup ON public.daily_briefings (user_id, platform, briefing_date DESC);
CREATE INDEX idx_briefing_actions_briefing ON public.briefing_actions (briefing_id, rank);

CREATE TRIGGER trg_daily_briefings_updated BEFORE UPDATE ON public.daily_briefings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_briefing_actions_updated BEFORE UPDATE ON public.briefing_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_revenue_goals_updated BEFORE UPDATE ON public.revenue_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();