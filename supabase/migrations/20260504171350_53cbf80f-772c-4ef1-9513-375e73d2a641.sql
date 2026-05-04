ALTER TABLE public.chatter_history_live ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view live data"
ON public.chatter_history_live
FOR SELECT
TO authenticated
USING (true);

ALTER TABLE public.chatter_history_live REPLICA IDENTITY FULL;