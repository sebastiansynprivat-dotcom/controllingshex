
-- Coaching materials (workspace-wide)
CREATE TABLE public.coaching_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_materials TO authenticated;
GRANT ALL ON public.coaching_materials TO service_role;

ALTER TABLE public.coaching_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read coaching_materials"
  ON public.coaching_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated write coaching_materials"
  ON public.coaching_materials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update coaching_materials"
  ON public.coaching_materials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated delete coaching_materials"
  ON public.coaching_materials FOR DELETE TO authenticated USING (true);

CREATE TRIGGER coaching_materials_updated_at
  BEFORE UPDATE ON public.coaching_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Coaching analyses (per user)
CREATE TABLE public.coaching_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  chatter_name TEXT NOT NULL,
  model_username TEXT,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  pdf_path TEXT NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  chats_analyzed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX coaching_analyses_lookup_idx
  ON public.coaching_analyses (user_id, platform, chatter_name, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_analyses TO authenticated;
GRANT ALL ON public.coaching_analyses TO service_role;

ALTER TABLE public.coaching_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own coaching_analyses select"
  ON public.coaching_analyses FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own coaching_analyses insert"
  ON public.coaching_analyses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own coaching_analyses update"
  ON public.coaching_analyses FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own coaching_analyses delete"
  ON public.coaching_analyses FOR DELETE TO authenticated USING (auth.uid() = user_id);
