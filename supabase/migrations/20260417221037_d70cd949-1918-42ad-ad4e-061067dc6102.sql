CREATE TABLE public.chatter_inputs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  chatter_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  input_type TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chatter_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own inputs"
ON public.chatter_inputs FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inputs"
ON public.chatter_inputs FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inputs"
ON public.chatter_inputs FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_chatter_inputs_lookup ON public.chatter_inputs(user_id, platform, chatter_name, created_at DESC);