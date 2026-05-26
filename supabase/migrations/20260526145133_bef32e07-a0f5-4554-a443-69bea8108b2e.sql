CREATE TABLE public.model_labels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  label_name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, label_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_labels TO authenticated;
GRANT ALL ON public.model_labels TO service_role;

ALTER TABLE public.model_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own model_labels" ON public.model_labels FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own model_labels" ON public.model_labels FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own model_labels" ON public.model_labels FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own model_labels" ON public.model_labels FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role model_labels" ON public.model_labels FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.model_label_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL,
  model_name TEXT NOT NULL,
  label_id UUID NOT NULL REFERENCES public.model_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, model_name, label_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.model_label_assignments TO authenticated;
GRANT ALL ON public.model_label_assignments TO service_role;

ALTER TABLE public.model_label_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own model_label_assignments" ON public.model_label_assignments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own model_label_assignments" ON public.model_label_assignments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own model_label_assignments" ON public.model_label_assignments FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role model_label_assignments" ON public.model_label_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_model_label_assignments_lookup ON public.model_label_assignments (user_id, platform, model_name);
CREATE INDEX idx_model_label_assignments_label ON public.model_label_assignments (label_id);