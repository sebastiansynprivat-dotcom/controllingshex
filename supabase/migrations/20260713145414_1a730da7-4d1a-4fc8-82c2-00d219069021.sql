
CREATE TABLE public.anomaly_snooze (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  chatter_name TEXT NOT NULL,
  alert_type TEXT,
  snoozed_until DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.anomaly_snooze TO authenticated;
GRANT ALL ON public.anomaly_snooze TO service_role;

ALTER TABLE public.anomaly_snooze ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snoozes"
  ON public.anomaly_snooze FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snoozes"
  ON public.anomaly_snooze FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own snoozes"
  ON public.anomaly_snooze FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_anomaly_snooze_user_platform ON public.anomaly_snooze (user_id, platform, snoozed_until);
