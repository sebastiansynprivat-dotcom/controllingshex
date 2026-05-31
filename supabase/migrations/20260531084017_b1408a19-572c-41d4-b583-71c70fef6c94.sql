CREATE TYPE public.goal_message_scenario AS ENUM ('growth','flat','decline');

CREATE TABLE public.goal_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scenario public.goal_message_scenario NOT NULL,
  template text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scenario)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_message_templates TO authenticated;
GRANT ALL ON public.goal_message_templates TO service_role;

ALTER TABLE public.goal_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own templates select" ON public.goal_message_templates
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own templates insert" ON public.goal_message_templates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own templates update" ON public.goal_message_templates
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own templates delete" ON public.goal_message_templates
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER tr_goal_message_templates_updated_at
  BEFORE UPDATE ON public.goal_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();