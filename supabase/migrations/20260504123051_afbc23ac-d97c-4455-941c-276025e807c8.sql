DROP POLICY IF EXISTS "Admins can view chatter_history_live" ON public.chatter_history_live;
DROP POLICY IF EXISTS "Service role full access chatter_history_live" ON public.chatter_history_live;
ALTER TABLE public.chatter_history_live DISABLE ROW LEVEL SECURITY;