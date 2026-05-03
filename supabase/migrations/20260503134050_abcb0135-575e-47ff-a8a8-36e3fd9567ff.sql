
-- channel_knowledge
CREATE TABLE public.channel_knowledge (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.channel_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_select_own" ON public.channel_knowledge FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "knowledge_insert_own" ON public.channel_knowledge FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "knowledge_update_own" ON public.channel_knowledge FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "knowledge_delete_own" ON public.channel_knowledge FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER channel_knowledge_updated BEFORE UPDATE ON public.channel_knowledge FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- channel_plans
CREATE TABLE public.channel_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  week_start DATE NOT NULL,
  generation_context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.channel_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_select_own" ON public.channel_plans FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plans_insert_own" ON public.channel_plans FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plans_update_own" ON public.channel_plans FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plans_delete_own" ON public.channel_plans FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_channel_plans_user_platform_week ON public.channel_plans(user_id, platform, week_start DESC);

-- channel_plan_days
CREATE TABLE public.channel_plan_days (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.channel_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  plan_date DATE NOT NULL,
  weekday INTEGER NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  post_text TEXT NOT NULL DEFAULT '',
  context_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.channel_plan_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_days_select_own" ON public.channel_plan_days FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_days_insert_own" ON public.channel_plan_days FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "plan_days_update_own" ON public.channel_plan_days FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "plan_days_delete_own" ON public.channel_plan_days FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_channel_plan_days_plan ON public.channel_plan_days(plan_id, position);
CREATE TRIGGER channel_plan_days_updated BEFORE UPDATE ON public.channel_plan_days FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
