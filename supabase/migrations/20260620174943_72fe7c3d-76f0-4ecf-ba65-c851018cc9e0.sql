CREATE TABLE public.weekly_goal_skips (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'Maloum',
  chatter_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_goal_skips TO authenticated;
GRANT ALL ON public.weekly_goal_skips TO service_role;

ALTER TABLE public.weekly_goal_skips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own weekly goal skips"
ON public.weekly_goal_skips FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own weekly goal skips"
ON public.weekly_goal_skips FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own weekly goal skips"
ON public.weekly_goal_skips FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Service role full access weekly goal skips"
ON public.weekly_goal_skips FOR ALL TO service_role
USING (true) WITH CHECK (true);