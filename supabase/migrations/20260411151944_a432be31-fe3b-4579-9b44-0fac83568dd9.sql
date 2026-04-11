
CREATE TABLE public.video_coachings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  chatter_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.video_coachings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own video_coachings"
  ON public.video_coachings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own video_coachings"
  ON public.video_coachings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own video_coachings"
  ON public.video_coachings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
