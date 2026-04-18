CREATE TABLE public.swap_decisions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  chatter_a TEXT NOT NULL,
  chatter_b TEXT NOT NULL,
  model_a TEXT,
  model_b TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.swap_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own swap_decisions"
  ON public.swap_decisions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own swap_decisions"
  ON public.swap_decisions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own swap_decisions"
  ON public.swap_decisions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_swap_decisions_user_platform ON public.swap_decisions(user_id, platform);