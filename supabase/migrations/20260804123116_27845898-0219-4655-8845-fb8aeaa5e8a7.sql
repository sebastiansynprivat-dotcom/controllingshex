DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'snapshot-weekly-goals-monday';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'snapshot-weekly-goals-tuesday';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'snapshot-weekly-goals-tuesday',
  '0 6 * * 2',
  $cron$
  SELECT net.http_post(
    url := 'https://kgtbciqqvctjrelgbdvx.supabase.co/functions/v1/snapshot-weekly-goals',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtndGJjaXFxdmN0anJlbGdiZHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzg5NzIsImV4cCI6MjA5MDcxNDk3Mn0.TS5imvZbHpmtv-vXaPD4mCj3flE9iHInwp6-Kp3IhFs","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtndGJjaXFxdmN0anJlbGdiZHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzg5NzIsImV4cCI6MjA5MDcxNDk3Mn0.TS5imvZbHpmtv-vXaPD4mCj3flE9iHInwp6-Kp3IhFs"}'::jsonb,
    body := jsonb_build_object('time', now())
  ) AS request_id;
  $cron$
);