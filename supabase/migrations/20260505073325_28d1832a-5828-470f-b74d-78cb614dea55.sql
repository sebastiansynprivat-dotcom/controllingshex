CREATE TABLE public.chatter_hourly_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'Maloum',
  chatter_name text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  hour integer NOT NULL CHECK (hour >= 0 AND hour <= 23),
  revenue numeric NOT NULL DEFAULT 0,
  mass_dms integer NOT NULL DEFAULT 0,
  unread_delta integer NOT NULL DEFAULT 0,
  updates_seen integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, platform, chatter_name, date, hour)
);

CREATE INDEX idx_chatter_hourly_stats_lookup
  ON public.chatter_hourly_stats(user_id, platform, chatter_name, date);

ALTER TABLE public.chatter_hourly_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own hourly stats" ON public.chatter_hourly_stats
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own hourly stats" ON public.chatter_hourly_stats
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own hourly stats" ON public.chatter_hourly_stats
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own hourly stats" ON public.chatter_hourly_stats
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role full access to chatter_hourly_stats" ON public.chatter_hourly_stats
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER set_chatter_hourly_stats_updated_at
  BEFORE UPDATE ON public.chatter_hourly_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();