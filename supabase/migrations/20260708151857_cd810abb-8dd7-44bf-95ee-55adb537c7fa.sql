CREATE TABLE public.waste_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  chatter_name text NOT NULL,
  account text NOT NULL,
  dismissed_at_analysis_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, chatter_name, account)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.waste_dismissals TO authenticated;
GRANT ALL ON public.waste_dismissals TO service_role;

ALTER TABLE public.waste_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "waste_dismissals_select_own" ON public.waste_dismissals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "waste_dismissals_insert_own" ON public.waste_dismissals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "waste_dismissals_update_own" ON public.waste_dismissals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "waste_dismissals_delete_own" ON public.waste_dismissals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_waste_dismissals_updated_at
  BEFORE UPDATE ON public.waste_dismissals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();