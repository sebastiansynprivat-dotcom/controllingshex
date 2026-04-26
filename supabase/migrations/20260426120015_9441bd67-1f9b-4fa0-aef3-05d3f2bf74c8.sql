-- Tabelle für abgehakte Auffälligkeiten (gilt bis zum nächsten Report)
CREATE TABLE public.alert_dismissals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  chatter_name TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  report_id UUID NOT NULL,
  dismissed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name, alert_type, report_id)
);

CREATE INDEX idx_alert_dismissals_lookup
  ON public.alert_dismissals (user_id, platform, report_id);

ALTER TABLE public.alert_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dismissals"
  ON public.alert_dismissals FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dismissals"
  ON public.alert_dismissals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own dismissals"
  ON public.alert_dismissals FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
