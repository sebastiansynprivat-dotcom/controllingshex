WITH latest AS (
  SELECT id, platform, analysis_date
  FROM public.analysis_reports
  WHERE platform = 'Brezzels'
  ORDER BY analysis_date DESC, created_at DESC
  LIMIT 1
), expanded AS (
  SELECT
    r.id,
    r.analysis_date,
    elem,
    chatter,
    CASE
      WHEN chatter->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$'
        THEN r.analysis_date - (chatter->>'startDate')::date
      WHEN chatter->>'startDate' ~ '^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$'
        THEN r.analysis_date - to_date(chatter->>'startDate', 'DD.MM.YYYY')
      ELSE NULL
    END AS start_day
  FROM public.analysis_reports r
  JOIN latest l ON l.id = r.id
  CROSS JOIN LATERAL jsonb_array_elements(r.result_json->'categories') AS elem
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(elem->'chatters', '[]'::jsonb)) AS chatter
), categorized AS (
  SELECT
    id,
    CASE
      WHEN start_day BETWEEN 1 AND 14 THEN 'ONBOARDING TAG ' || start_day::text
      ELSE elem->>'categoryName'
    END AS category_name,
    CASE
      WHEN start_day BETWEEN 1 AND 14 THEN '🔵'
      ELSE COALESCE(elem->>'emoji', '👀')
    END AS emoji,
    chatter
  FROM expanded
), grouped AS (
  SELECT
    id,
    category_name,
    emoji,
    jsonb_agg(chatter ORDER BY chatter->>'name') AS chatters,
    CASE
      WHEN category_name ~ '^ONBOARDING TAG \d+$' THEN (regexp_match(category_name, '\d+$'))[1]::int
      WHEN category_name = 'SOFORT EINGREIFEN' THEN 20
      WHEN category_name = 'COACHING NÖTIG' THEN 30
      WHEN category_name = 'PUSHEN' THEN 40
      WHEN category_name = 'BELOHNEN' THEN 50
      WHEN category_name = 'RE-ASSIGNEN' THEN 60
      ELSE 70
    END AS sort_order
  FROM categorized
  GROUP BY id, category_name, emoji
), rebuilt AS (
  SELECT
    id,
    jsonb_agg(
      jsonb_build_object(
        'emoji', emoji,
        'categoryName', category_name,
        'chatters', chatters
      )
      ORDER BY sort_order, category_name
    ) AS categories
  FROM grouped
  GROUP BY id
)
UPDATE public.analysis_reports r
SET result_json = jsonb_set(r.result_json, '{categories}', rebuilt.categories, true)
FROM rebuilt
WHERE r.id = rebuilt.id;

WITH latest AS (
  SELECT id, platform, analysis_date
  FROM public.analysis_reports
  WHERE platform = 'Brezzels'
  ORDER BY analysis_date DESC, created_at DESC
  LIMIT 1
), corrected AS (
  SELECT
    r.platform,
    r.analysis_date,
    chatter->>'name' AS chatter_name,
    chatter->>'account' AS account,
    elem->>'categoryName' AS category_name
  FROM public.analysis_reports r
  JOIN latest l ON l.id = r.id
  CROSS JOIN LATERAL jsonb_array_elements(r.result_json->'categories') AS elem
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(elem->'chatters', '[]'::jsonb)) AS chatter
  WHERE elem->>'categoryName' LIKE 'ONBOARDING TAG %'
)
UPDATE public.chatter_history h
SET category = c.category_name
FROM corrected c
WHERE h.platform = c.platform
  AND h.analysis_date = c.analysis_date
  AND lower(trim(h.chatter_name)) = lower(trim(c.chatter_name))
  AND COALESCE(lower(trim(h.account)), '') = COALESCE(lower(trim(c.account)), '');