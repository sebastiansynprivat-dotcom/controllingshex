
-- Table for label definitions
CREATE TABLE public.chatter_labels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  label_name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chatter_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own labels" ON public.chatter_labels FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own labels" ON public.chatter_labels FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own labels" ON public.chatter_labels FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own labels" ON public.chatter_labels FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Table for label-to-chatter assignments
CREATE TABLE public.chatter_label_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  chatter_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  label_id UUID NOT NULL REFERENCES public.chatter_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, chatter_name, platform, label_id)
);

ALTER TABLE public.chatter_label_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own assignments" ON public.chatter_label_assignments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own assignments" ON public.chatter_label_assignments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own assignments" ON public.chatter_label_assignments FOR DELETE TO authenticated USING (auth.uid() = user_id);
