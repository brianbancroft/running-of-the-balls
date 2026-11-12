-- Demo catalogue so the picker can show blocks of 100.
-- The live draw size is still undecided. The UI marks the count as a placeholder.
INSERT INTO balls (id, ball_number, label, color, status)
SELECT
  n,
  n,
  CASE WHEN n = 1000 THEN 'Ball 1000' ELSE 'Ball ' || printf('%03d', n) END,
  '#FFC234',
  'available'
FROM (
  WITH RECURSIVE seq(n) AS (
    SELECT 49
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 1000
  )
  SELECT n FROM seq
);
