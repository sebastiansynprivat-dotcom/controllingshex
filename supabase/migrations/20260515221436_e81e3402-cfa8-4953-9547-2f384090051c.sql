CREATE TABLE public.talent_account_rejections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  riser_norm TEXT NOT NULL,
  account_norm TEXT NOT NULL,
  rejected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_talent_rejections_lookup
  ON public.talent_account_rejections (user_id, platform, rejected_at DESC);

ALTER TABLE public.talent_account_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own talent rejections"
  ON public.talent_account_rejections FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own talent rejections"
  ON public.talent_account_rejections FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own talent rejections"
  ON public.talent_account_rejections FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
