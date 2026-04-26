CREATE TABLE public.chatter_daily_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  chatter_name TEXT NOT NULL,
  goal_date DATE NOT NULL DEFAULT CURRENT_DATE,
  goal_eur NUMERIC NOT NULL,
  suggested_eur NUMERIC,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chatter_daily_goals_unique
  ON public.chatter_daily_goals (user_id, platform, chatter_name, goal_date);

CREATE INDEX chatter_daily_goals_lookup
  ON public.chatter_daily_goals (user_id, platform, goal_date);

ALTER TABLE public.chatter_daily_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily goals"
  ON public.chatter_daily_goals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily goals"
  ON public.chatter_daily_goals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily goals"
  ON public.chatter_daily_goals FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily goals"
  ON public.chatter_daily_goals FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to chatter_daily_goals"
  ON public.chatter_daily_goals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_chatter_daily_goals_updated_at
  BEFORE UPDATE ON public.chatter_daily_goals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();