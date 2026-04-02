
-- Create models table for storing model names and follower counts
CREATE TABLE public.models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_name TEXT NOT NULL,
  follower_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create settings table for storing system prompt
CREATE TABLE public.settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Public access policies (internal tool, no auth needed initially)
CREATE POLICY "Allow all access to models" ON public.models FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);

-- Insert default system prompt
INSERT INTO public.settings (key, value) VALUES ('system_prompt', '');

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_models_updated_at BEFORE UPDATE ON public.models FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
