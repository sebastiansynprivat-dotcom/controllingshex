CREATE TABLE public.model_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  model_name TEXT NOT NULL,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_notes TO authenticated;
GRANT ALL ON public.model_notes TO service_role;

ALTER TABLE public.model_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own model_notes" ON public.model_notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own model_notes" ON public.model_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own model_notes" ON public.model_notes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own model_notes" ON public.model_notes FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role model_notes" ON public.model_notes FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_model_notes_lookup ON public.model_notes (user_id, platform, model_name, created_at DESC);

CREATE TRIGGER update_model_notes_updated_at
BEFORE UPDATE ON public.model_notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();