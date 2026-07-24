
CREATE POLICY "coaching-memos owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coaching-memos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "coaching-memos owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'coaching-memos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "coaching-memos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'coaching-memos' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'coaching-memos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "coaching-memos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'coaching-memos' AND auth.uid()::text = (storage.foldername(name))[1]);
