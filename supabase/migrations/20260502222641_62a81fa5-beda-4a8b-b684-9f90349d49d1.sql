ALTER TABLE public.text_snippets ADD COLUMN IF NOT EXISTS media_urls TEXT[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public) VALUES ('snippet-media', 'snippet-media', false) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can view own snippet media" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can upload own snippet media" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can update own snippet media" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users can delete own snippet media" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'snippet-media' AND auth.uid()::text = (storage.foldername(name))[1]);