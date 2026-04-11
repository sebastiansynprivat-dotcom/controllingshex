
-- Add user_id to all tables
ALTER TABLE public.analysis_reports ADD COLUMN user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.chatter_history ADD COLUMN user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.coaching_notes ADD COLUMN user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.models ADD COLUMN user_id UUID REFERENCES auth.users(id);
ALTER TABLE public.settings ADD COLUMN user_id UUID REFERENCES auth.users(id);

-- Drop old permissive policies
DROP POLICY IF EXISTS "Allow all access to analysis_reports" ON public.analysis_reports;
DROP POLICY IF EXISTS "Allow all access to chatter_history" ON public.chatter_history;
DROP POLICY IF EXISTS "Allow all access to coaching_notes" ON public.coaching_notes;
DROP POLICY IF EXISTS "Allow all access to models" ON public.models;
DROP POLICY IF EXISTS "Allow all access to settings" ON public.settings;

-- analysis_reports RLS
CREATE POLICY "Users can view own reports" ON public.analysis_reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own reports" ON public.analysis_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reports" ON public.analysis_reports FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own reports" ON public.analysis_reports FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- chatter_history RLS
CREATE POLICY "Users can view own chatter_history" ON public.chatter_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chatter_history" ON public.chatter_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chatter_history" ON public.chatter_history FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chatter_history" ON public.chatter_history FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- coaching_notes RLS
CREATE POLICY "Users can view own coaching_notes" ON public.coaching_notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own coaching_notes" ON public.coaching_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own coaching_notes" ON public.coaching_notes FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own coaching_notes" ON public.coaching_notes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- models RLS
CREATE POLICY "Users can view own models" ON public.models FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own models" ON public.models FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own models" ON public.models FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own models" ON public.models FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- settings RLS
CREATE POLICY "Users can view own settings" ON public.settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.settings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own settings" ON public.settings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Storage policies for report-files bucket
CREATE POLICY "Users can upload own report files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'report-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can view own report files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'report-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own report files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'report-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Allow service role full access for edge functions
CREATE POLICY "Service role full access to analysis_reports" ON public.analysis_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to chatter_history" ON public.chatter_history FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to coaching_notes" ON public.coaching_notes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to models" ON public.models FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to settings" ON public.settings FOR ALL TO service_role USING (true) WITH CHECK (true);
