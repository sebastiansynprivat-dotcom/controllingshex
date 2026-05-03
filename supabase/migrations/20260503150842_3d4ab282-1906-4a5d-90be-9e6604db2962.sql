CREATE TABLE public.standard_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.standard_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "standard_notes_select_own" ON public.standard_notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "standard_notes_insert_own" ON public.standard_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "standard_notes_update_own" ON public.standard_notes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "standard_notes_delete_own" ON public.standard_notes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_standard_notes_updated_at
BEFORE UPDATE ON public.standard_notes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();