CREATE TABLE public.action_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  event_type text NOT NULL,
  event_key text NOT NULL,
  chatter_name text,
  counterpart_chatter text,
  account text,
  prev_account text,
  report_id uuid,
  detected_on date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  detected_at timestamptz NOT NULL DEFAULT now(),
  baseline_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz,
  verdict text,
  verdict_reason text,
  recommendation text,
  impact_eur numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, event_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_events TO authenticated;
GRANT ALL ON public.action_events TO service_role;

ALTER TABLE public.action_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own action events"
ON public.action_events FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_action_events_user_platform ON public.action_events (user_id, platform, detected_on DESC);
CREATE INDEX idx_action_events_pending ON public.action_events (user_id, platform, evaluated_at);

CREATE TRIGGER update_action_events_updated_at
BEFORE UPDATE ON public.action_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();