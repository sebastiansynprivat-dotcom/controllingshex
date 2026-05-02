CREATE TABLE public.snippet_sends (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  snippet_id UUID NOT NULL REFERENCES public.text_snippets(id) ON DELETE CASCADE,
  chatter_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, snippet_id, chatter_name, platform)
);

ALTER TABLE public.snippet_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snippet_sends" ON public.snippet_sends FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own snippet_sends" ON public.snippet_sends FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own snippet_sends" ON public.snippet_sends FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_snippet_sends_user_snippet ON public.snippet_sends(user_id, snippet_id);
CREATE INDEX idx_snippet_sends_chatter ON public.snippet_sends(user_id, chatter_name, platform);