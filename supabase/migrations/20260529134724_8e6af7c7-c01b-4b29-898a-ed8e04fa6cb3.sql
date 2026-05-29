
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subs - select" ON public.push_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users manage own push subs - insert" ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own push subs - update" ON public.push_subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users manage own push subs - delete" ON public.push_subscriptions FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_push_subscriptions_updated_at
BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.hot_streak_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  chatter_name TEXT NOT NULL,
  alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
  revenue_at_alert NUMERIC NOT NULL DEFAULT 0,
  expected_pace NUMERIC NOT NULL DEFAULT 0,
  pace_pct NUMERIC NOT NULL DEFAULT 0,
  baseline_avg NUMERIC NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hot_streak_alerts_lookup ON public.hot_streak_alerts (user_id, platform, chatter_name, alert_date, sent_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hot_streak_alerts TO authenticated;
GRANT ALL ON public.hot_streak_alerts TO service_role;

ALTER TABLE public.hot_streak_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own hot streak alerts" ON public.hot_streak_alerts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role inserts hot streak alerts" ON public.hot_streak_alerts FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Users delete own hot streak alerts" ON public.hot_streak_alerts FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.hot_streak_alerts;
ALTER TABLE public.hot_streak_alerts REPLICA IDENTITY FULL;
