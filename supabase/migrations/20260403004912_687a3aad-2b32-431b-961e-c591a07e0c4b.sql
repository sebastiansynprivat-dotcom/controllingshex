CREATE TABLE public.coaching_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chatter_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  note_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.coaching_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to coaching_notes"
  ON public.coaching_notes
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);