-- The catalogue count is 2,500 balls.
-- Earlier migrations already inserted balls 1 through 1000, so this only adds the rest.
-- These rows keep sequential ids so the picker has a full catalogue.
-- The public numbering scheme is still unconfirmed.

INSERT INTO balls (id, ball_number, label, color, status)
SELECT
  n,
  n,
  'Ball ' || n,
  '#FFC234',
  'available'
FROM (
  WITH RECURSIVE seq(n) AS (
    SELECT 1001
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 2500
  )
  SELECT n FROM seq
);
