
-- Cleanup test record
DELETE FROM public.chatter_history WHERE chatter_name = '__test__';

-- Backfill chatter_history from analysis_reports for missing dates (>= 2026-04-18)
WITH report_chatters AS (
  SELECT
    r.user_id, r.platform, r.analysis_date, r.created_at AS report_created,
    cat->>'categoryName' AS category,
    chatter
  FROM public.analysis_reports r
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.result_json->'categories', '[]'::jsonb)) AS cat
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cat->'chatters', '[]'::jsonb)) AS chatter
  WHERE r.analysis_date >= '2026-04-18'
    AND r.user_id IS NOT NULL
    AND r.result_json IS NOT NULL
),
ranked AS (
  SELECT
    user_id, platform, analysis_date, category, chatter,
    ROW_NUMBER() OVER (
      PARTITION BY platform, analysis_date,
        initcap(replace(COALESCE(chatter->>'name',''),'_',' '))
      ORDER BY report_created DESC
    ) AS rn
  FROM report_chatters
),
parsed AS (
  SELECT
    user_id, platform, analysis_date, category, chatter,
    initcap(replace(COALESCE(chatter->>'name',''),'_',' ')) AS chatter_name,
    COALESCE(chatter->>'account','') AS account,
    COALESCE((
      SELECT NULLIF(regexp_replace(replace(value, ',', '.'), '[^0-9.\-]', '', 'g'), '')::numeric
      FROM jsonb_each_text(COALESCE(chatter->'kpis','{}'::jsonb))
      WHERE key ~* 'umsatz|revenue' LIMIT 1
    ), 0) AS revenue_today,
    COALESCE((
      SELECT NULLIF(regexp_replace(value, '[^0-9]', '', 'g'), '')::int
      FROM jsonb_each_text(COALESCE(chatter->'kpis','{}'::jsonb))
      WHERE key ~* 'mass\s*dm' LIMIT 1
    ), 0) AS mass_dms,
    COALESCE((
      SELECT NULLIF((regexp_match(value, '(\d+)'))[1], '')::int
      FROM jsonb_each_text(COALESCE(chatter->'kpis','{}'::jsonb))
      WHERE key ~* 'offene?\s*chats?|open\s*chats?' LIMIT 1
    ), 0) AS open_chats,
    LEAST(COALESCE((
      SELECT NULLIF((regexp_match(value, 'seit\s*(\d+)'))[1], '')::int
      FROM jsonb_each_text(COALESCE(chatter->'kpis','{}'::jsonb))
      WHERE key ~* 'offene?\s*chats?|open\s*chats?' LIMIT 1
    ), 0), 30) AS response_delay_days
  FROM ranked
  WHERE rn = 1
)
INSERT INTO public.chatter_history
  (chatter_name, account, platform, analysis_date, user_id, category, recommendation,
   revenue_today, mass_dms, open_chats, response_delay_days)
SELECT
  chatter_name, account, platform, analysis_date, user_id, category,
  chatter->>'recommendation',
  revenue_today, mass_dms, open_chats, response_delay_days
FROM parsed
WHERE chatter_name <> ''
ON CONFLICT (chatter_name, platform, analysis_date)
DO UPDATE SET
  revenue_today = EXCLUDED.revenue_today,
  mass_dms = EXCLUDED.mass_dms,
  open_chats = EXCLUDED.open_chats,
  response_delay_days = EXCLUDED.response_delay_days,
  category = EXCLUDED.category,
  recommendation = EXCLUDED.recommendation,
  account = EXCLUDED.account,
  user_id = EXCLUDED.user_id;
