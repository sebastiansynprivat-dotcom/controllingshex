
CREATE TABLE public.chatter_category_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  chatter_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  current_category TEXT NOT NULL,
  since_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_signals JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name)
);

CREATE INDEX idx_chatter_category_state_user_platform
  ON public.chatter_category_state (user_id, platform);

ALTER TABLE public.chatter_category_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own category state"
  ON public.chatter_category_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own category state"
  ON public.chatter_category_state FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own category state"
  ON public.chatter_category_state FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own category state"
  ON public.chatter_category_state FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to chatter_category_state"
  ON public.chatter_category_state FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_chatter_category_state_updated_at
  BEFORE UPDATE ON public.chatter_category_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
