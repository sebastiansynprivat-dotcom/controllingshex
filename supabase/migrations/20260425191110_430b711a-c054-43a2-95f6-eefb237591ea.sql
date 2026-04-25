-- Backfill chatter_history from analysis_reports.result_json for missing days
DO $$
DECLARE
  rep RECORD;
  cat_elem JSONB;
  ch JSONB;
  kpi_key TEXT;
  kpi_val TEXT;
  v_name TEXT;
  v_revenue NUMERIC;
  v_mass_dms INT;
  v_open_chats INT;
  v_delay INT;
  v_account TEXT;
  v_category TEXT;
  v_recommendation TEXT;
  m TEXT[];
BEGIN
  FOR rep IN
    SELECT id, platform, analysis_date, result_json, user_id
    FROM analysis_reports
    WHERE analysis_date >= '2026-04-21'
      AND result_json IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM chatter_history ch
        WHERE ch.platform = analysis_reports.platform
          AND ch.analysis_date = analysis_reports.analysis_date
      )
  LOOP
    FOR cat_elem IN SELECT * FROM jsonb_array_elements(COALESCE(rep.result_json->'categories', '[]'::jsonb))
    LOOP
      v_category := cat_elem->>'categoryName';
      FOR ch IN SELECT * FROM jsonb_array_elements(COALESCE(cat_elem->'chatters', '[]'::jsonb))
      LOOP
        v_name := initcap(replace(COALESCE(ch->>'name',''), '_', ' '));
        v_recommendation := ch->>'recommendation';
        v_account := COALESCE(ch->>'account', '');
        v_revenue := 0; v_mass_dms := 0; v_open_chats := 0; v_delay := 0;

        -- revenue
        SELECT key INTO kpi_key FROM jsonb_object_keys(COALESCE(ch->'kpis','{}'::jsonb)) AS key
          WHERE key ~* 'umsatz|revenue' LIMIT 1;
        IF kpi_key IS NOT NULL THEN
          kpi_val := ch->'kpis'->>kpi_key;
          v_revenue := COALESCE(NULLIF(regexp_replace(replace(kpi_val, ',', '.'), '[^0-9.\-]', '', 'g'), ''), '0')::numeric;
        END IF;

        -- mass dms
        SELECT key INTO kpi_key FROM jsonb_object_keys(COALESCE(ch->'kpis','{}'::jsonb)) AS key
          WHERE key ~* 'mass\s*dm' LIMIT 1;
        IF kpi_key IS NOT NULL THEN
          kpi_val := ch->'kpis'->>kpi_key;
          v_mass_dms := COALESCE(NULLIF(regexp_replace(kpi_val, '[^0-9\-]', '', 'g'), ''), '0')::int;
        END IF;

        -- open chats / delay
        SELECT key INTO kpi_key FROM jsonb_object_keys(COALESCE(ch->'kpis','{}'::jsonb)) AS key
          WHERE key ~* 'offene?\s*chats?|open\s*chats?' LIMIT 1;
        IF kpi_key IS NOT NULL THEN
          kpi_val := ch->'kpis'->>kpi_key;
          m := regexp_match(kpi_val, '(\d+)\s*(?:chats?)\s*seit\s*(\d+)', 'i');
          IF m IS NOT NULL THEN
            v_open_chats := m[1]::int;
            v_delay := m[2]::int;
          ELSE
            m := regexp_match(kpi_val, '(\d+)');
            IF m IS NOT NULL THEN v_open_chats := m[1]::int; END IF;
          END IF;
          IF v_delay > 30 THEN v_delay := 0; END IF;
        END IF;

        IF v_name <> '' THEN
          INSERT INTO chatter_history
            (chatter_name, revenue_today, mass_dms, open_chats, response_delay_days,
             platform, analysis_date, category, recommendation, user_id, account)
          VALUES
            (v_name, v_revenue, v_mass_dms, v_open_chats, v_delay,
             rep.platform, rep.analysis_date, v_category, v_recommendation, rep.user_id, v_account)
          ON CONFLICT (chatter_name, (COALESCE(account,'')), platform, analysis_date) DO UPDATE SET
            revenue_today = EXCLUDED.revenue_today,
            mass_dms = EXCLUDED.mass_dms,
            open_chats = EXCLUDED.open_chats,
            response_delay_days = EXCLUDED.response_delay_days,
            category = EXCLUDED.category,
            recommendation = EXCLUDED.recommendation;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;