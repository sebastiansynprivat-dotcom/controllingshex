CREATE TABLE public.text_snippets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  day_offset INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.text_snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snippets" ON public.text_snippets FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own snippets" ON public.text_snippets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own snippets" ON public.text_snippets FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own snippets" ON public.text_snippets FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_text_snippets_user_platform ON public.text_snippets(user_id, platform, day_offset, position);

CREATE TRIGGER update_text_snippets_updated_at
BEFORE UPDATE ON public.text_snippets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();