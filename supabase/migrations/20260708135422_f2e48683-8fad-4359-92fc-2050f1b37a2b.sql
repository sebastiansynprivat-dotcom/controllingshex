
CREATE TABLE public.chatter_incoming_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'Maloum',
  chatter_name text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  incoming_count integer NOT NULL DEFAULT 0,
  last_unread integer,
  last_revenue numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name, date)
);

CREATE INDEX idx_chatter_incoming_stats_lookup
  ON public.chatter_incoming_stats (user_id, platform, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chatter_incoming_stats TO authenticated;
GRANT ALL ON public.chatter_incoming_stats TO service_role;

ALTER TABLE public.chatter_incoming_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own incoming stats"
  ON public.chatter_incoming_stats FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own incoming stats"
  ON public.chatter_incoming_stats FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own incoming stats"
  ON public.chatter_incoming_stats FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users delete own incoming stats"
  ON public.chatter_incoming_stats FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role full access incoming stats"
  ON public.chatter_incoming_stats FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER set_chatter_incoming_stats_updated_at
  BEFORE UPDATE ON public.chatter_incoming_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
