
-- Step 1: Remove duplicates, keeping the row with the latest created_at
DELETE FROM chatter_history
WHERE id NOT IN (
  SELECT DISTINCT ON (chatter_name, platform, analysis_date) id
  FROM chatter_history
  ORDER BY chatter_name, platform, analysis_date, created_at DESC
);

-- Step 2: Add unique constraint so upsert works correctly
CREATE UNIQUE INDEX chatter_history_dedup_idx 
ON chatter_history(chatter_name, platform, analysis_date);
