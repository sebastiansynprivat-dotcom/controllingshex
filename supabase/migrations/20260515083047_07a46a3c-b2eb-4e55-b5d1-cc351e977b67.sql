
-- Action ROI tracking (A1) + helpful feedback (A2)
CREATE TABLE public.action_outcomes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'Maloum',
  chatter_name text NOT NULL,
  action_type text NOT NULL,
  action_kind text,
  action_key text,
  estimated_eur numeric NOT NULL DEFAULT 0,
  baseline_revenue_7d numeric NOT NULL DEFAULT 0,
  done_at timestamp with time zone NOT NULL DEFAULT now(),
  -- snapshots filled by edge function or on-demand recompute
  revenue_before_24h numeric,
  revenue_after_24h numeric,
  revenue_after_48h numeric,
  revenue_after_72h numeric,
  delta_24h numeric,
  delta_48h numeric,
  delta_72h numeric,
  -- A2: user feedback
  helped boolean,
  feedback_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_outcomes_user_done ON public.action_outcomes(user_id, done_at DESC);
CREATE INDEX idx_action_outcomes_lookup ON public.action_outcomes(user_id, platform, chatter_name, action_type, done_at DESC);

ALTER TABLE public.action_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own action_outcomes"
ON public.action_outcomes FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own action_outcomes"
ON public.action_outcomes FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own action_outcomes"
ON public.action_outcomes FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users delete own action_outcomes"
ON public.action_outcomes FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role full access action_outcomes"
ON public.action_outcomes FOR ALL TO service_role
USING (true) WITH CHECK (true);

CREATE TRIGGER update_action_outcomes_updated_at
BEFORE UPDATE ON public.action_outcomes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
