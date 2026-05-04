-- Admin role infrastructure (separate table to avoid privilege escalation)
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Live chatter history table
CREATE TABLE IF NOT EXISTS public.chatter_history_live (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL DEFAULT 'Maloum',
  chatter_name text NOT NULL,
  telegram_id text,
  revenue numeric NOT NULL DEFAULT 0,
  mass_dms integer NOT NULL DEFAULT 0,
  unread_chats integer NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chatter_history_live_date ON public.chatter_history_live (date DESC);
CREATE INDEX IF NOT EXISTS idx_chatter_history_live_platform_chatter ON public.chatter_history_live (platform, chatter_name);

ALTER TABLE public.chatter_history_live ENABLE ROW LEVEL SECURITY;

-- Only admins can read
DROP POLICY IF EXISTS "Admins can view chatter_history_live" ON public.chatter_history_live;
CREATE POLICY "Admins can view chatter_history_live"
  ON public.chatter_history_live FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Service role full access (for the socket/backend writer)
DROP POLICY IF EXISTS "Service role full access chatter_history_live" ON public.chatter_history_live;
CREATE POLICY "Service role full access chatter_history_live"
  ON public.chatter_history_live FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_chatter_history_live_updated_at ON public.chatter_history_live;
CREATE TRIGGER trg_chatter_history_live_updated_at
  BEFORE UPDATE ON public.chatter_history_live
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER TABLE public.chatter_history_live REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.chatter_history_live;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;