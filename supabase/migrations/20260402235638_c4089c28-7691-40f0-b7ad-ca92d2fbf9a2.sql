CREATE TABLE public.chatter_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chatter_name TEXT NOT NULL,
  revenue_today NUMERIC DEFAULT 0,
  mass_dms INTEGER DEFAULT 0,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chatter_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to chatter_history"
  ON public.chatter_history FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);