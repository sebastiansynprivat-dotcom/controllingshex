
CREATE TABLE public.coaching_memos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  coaching_id UUID NOT NULL REFERENCES public.coaching_analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  card_key TEXT NOT NULL,
  audio_path TEXT NOT NULL,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (coaching_id, card_key)
);
CREATE INDEX coaching_memos_coaching_idx ON public.coaching_memos(coaching_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_memos TO authenticated;
GRANT ALL ON public.coaching_memos TO service_role;

ALTER TABLE public.coaching_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own memos select" ON public.coaching_memos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own memos insert" ON public.coaching_memos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own memos update" ON public.coaching_memos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own memos delete" ON public.coaching_memos FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_coaching_memos_updated_at
  BEFORE UPDATE ON public.coaching_memos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
