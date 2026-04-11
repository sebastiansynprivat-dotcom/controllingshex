
-- Create analysis_reports table
CREATE TABLE public.analysis_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'Maloum',
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  result_json JSONB,
  chatter_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.analysis_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to analysis_reports"
  ON public.analysis_reports
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Create storage bucket for report files
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-files', 'report-files', true);

-- Storage policies
CREATE POLICY "Allow public read on report-files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'report-files');

CREATE POLICY "Allow public upload to report-files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'report-files');

CREATE POLICY "Allow public delete on report-files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'report-files');
