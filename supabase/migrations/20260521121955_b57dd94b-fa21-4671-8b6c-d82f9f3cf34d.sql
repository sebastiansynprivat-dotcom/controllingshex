
CREATE TABLE public.chatter_memos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  chatter_name TEXT NOT NULL,
  text TEXT NOT NULL,
  topic TEXT,
  follow_up_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chatter_memos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memos_select_own" ON public.chatter_memos
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "memos_insert_own" ON public.chatter_memos
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "memos_update_own" ON public.chatter_memos
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "memos_delete_own" ON public.chatter_memos
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_chatter_memos_user_chatter ON public.chatter_memos (user_id, platform, chatter_name, created_at DESC);
CREATE INDEX idx_chatter_memos_followup ON public.chatter_memos (user_id, follow_up_at) WHERE status = 'open' AND follow_up_at IS NOT NULL;

CREATE TRIGGER trg_chatter_memos_updated
  BEFORE UPDATE ON public.chatter_memos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
