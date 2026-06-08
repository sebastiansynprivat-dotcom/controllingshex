
-- Duplikate in chatter_labels entfernen: ältestes Label pro (user_id, platform, label_name) behalten,
-- Assignments auf das behaltene Label umbiegen, Rest löschen.
WITH ranked AS (
  SELECT id, user_id, platform, label_name,
         ROW_NUMBER() OVER (PARTITION BY user_id, platform, label_name ORDER BY created_at ASC, id ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY user_id, platform, label_name ORDER BY created_at ASC, id ASC) AS keep_id
  FROM public.chatter_labels
),
dupes AS (
  SELECT id AS dup_id, keep_id FROM ranked WHERE rn > 1
)
UPDATE public.chatter_label_assignments a
SET label_id = d.keep_id
FROM dupes d
WHERE a.label_id = d.dup_id
  AND NOT EXISTS (
    SELECT 1 FROM public.chatter_label_assignments b
    WHERE b.user_id = a.user_id AND b.platform = a.platform
      AND b.chatter_name = a.chatter_name AND b.label_id = d.keep_id
  );

-- Übrig gebliebene Assignments auf Dupes (Konflikt mit Unique-Constraint) einfach löschen
DELETE FROM public.chatter_label_assignments
WHERE label_id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, platform, label_name ORDER BY created_at ASC, id ASC) AS rn
    FROM public.chatter_labels
  ) r WHERE r.rn > 1
);

-- Duplikate löschen
DELETE FROM public.chatter_labels
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, platform, label_name ORDER BY created_at ASC, id ASC) AS rn
    FROM public.chatter_labels
  ) r WHERE r.rn > 1
);

-- Unique-Constraint, damit es nie wieder passiert
ALTER TABLE public.chatter_labels
  ADD CONSTRAINT chatter_labels_user_platform_name_unique
  UNIQUE (user_id, platform, label_name);
