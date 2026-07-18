
CREATE TABLE public.chats_preview (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id text NOT NULL,
  platform text NOT NULL,
  model_username text NOT NULL,
  recipient_username text,
  chat jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, model_username, chat_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats_preview TO authenticated;
GRANT ALL ON public.chats_preview TO service_role;

ALTER TABLE public.chats_preview ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage chats_preview"
  ON public.chats_preview FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_chats_preview_updated_at
  BEFORE UPDATE ON public.chats_preview
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
