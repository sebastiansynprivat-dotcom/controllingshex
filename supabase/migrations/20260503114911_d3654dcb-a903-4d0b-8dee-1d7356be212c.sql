CREATE TABLE public.daily_todo_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  todo_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  snoozed_until TIMESTAMPTZ,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, todo_key)
);

ALTER TABLE public.daily_todo_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own todo state" ON public.daily_todo_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own todo state" ON public.daily_todo_state
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own todo state" ON public.daily_todo_state
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own todo state" ON public.daily_todo_state
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_daily_todo_state_user_date ON public.daily_todo_state(user_id, platform, acted_at DESC);