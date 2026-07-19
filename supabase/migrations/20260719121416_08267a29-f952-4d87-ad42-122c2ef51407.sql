
CREATE POLICY "coaching-pdfs own read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'coaching-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "coaching-pdfs own insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'coaching-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "coaching-pdfs own update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'coaching-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "coaching-pdfs own delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'coaching-pdfs' AND (storage.foldername(name))[1] = auth.uid()::text);
