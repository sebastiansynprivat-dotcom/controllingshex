CREATE TABLE public.anomaly_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  chatter_name TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  metric_value NUMERIC,
  baseline_value NUMERIC,
  delta_pct NUMERIC,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  detection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  snoozed_until TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name, alert_type, detection_date)
);

ALTER TABLE public.anomaly_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alerts" ON public.anomaly_alerts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own alerts" ON public.anomaly_alerts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own alerts" ON public.anomaly_alerts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own alerts" ON public.anomaly_alerts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role full access to anomaly_alerts" ON public.anomaly_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER set_anomaly_alerts_updated_at
  BEFORE UPDATE ON public.anomaly_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_anomaly_alerts_user_platform_status
  ON public.anomaly_alerts(user_id, platform, status, created_at DESC);