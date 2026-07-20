
CREATE TABLE public.chats_fetch_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  telegram_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  model_username TEXT,
  token TEXT,
  recipient_username TEXT,
  recipient_chat_id TEXT,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats_fetch_requests TO authenticated;
GRANT ALL ON public.chats_fetch_requests TO service_role;

ALTER TABLE public.chats_fetch_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own chat fetch requests"
  ON public.chats_fetch_requests
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_chats_fetch_requests_updated_at
  BEFORE UPDATE ON public.chats_fetch_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.chats_fetch_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chats_fetch_requests;
