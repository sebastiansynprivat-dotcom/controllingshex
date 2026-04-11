CREATE TABLE public.daily_chatter_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  chatter_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  check_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, chatter_name, platform, check_date)
);

ALTER TABLE public.daily_chatter_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily checks"
ON public.daily_chatter_checks FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily checks"
ON public.daily_chatter_checks FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily checks"
ON public.daily_chatter_checks FOR DELETE
TO authenticated
USING (auth.uid() = user_id);