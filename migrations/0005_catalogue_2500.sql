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

-- Receipt tokens used to live in a second file also numbered 0005
-- (0005_receipt_tokens.sql). Wrangler 4.160.1 and the Vitest helper
-- readD1Migrations both sort by the numeric prefix and then by the full
-- filename, so that file ran after this one, and both names were stored in
-- d1_migrations. The shared number was ambiguous, so the statements moved here.
--
-- A database that already applied 0005_catalogue_2500.sql skips this whole
-- file by filename and is not asked to add receipt_token again. If it also
-- applied 0005_receipt_tokens.sql, that name simply stays in d1_migrations
-- with no file beside it. Wrangler ignores an applied name that no longer
-- has a file. A fresh database runs the block below once, after the
-- catalogue insert above.
--
-- A database that applied this filename and did not apply
-- 0005_receipt_tokens.sql is missing the column. This demo has not been
-- deployed. Reset that local database and apply again.

ALTER TABLE purchases ADD COLUMN receipt_token TEXT;

UPDATE purchases
SET receipt_token = '390822ccb06855179424236c3774f960118070866e3030acb0808837a6ca55d3'
WHERE id = '10000000-0000-4000-8000-000000000003';

UPDATE purchases
SET receipt_token = '94839a0aa2074502500a843e3adf17763777026d5e2d192063f7b5d198cf3885'
WHERE id = '10000000-0000-4000-8000-000000000021';

UPDATE purchases
SET receipt_token = '41ea8a7d65273039db673ab93dbfd5f8653b5fb918700f4e840ac8652dc68f23'
WHERE id = '10000000-0000-4000-8000-000000000033';

UPDATE purchases
SET receipt_token = '40a5e9a85835719f3561d7c5337a639a222919c095ef5e8a70a5b67386904e00'
WHERE id = '10000000-0000-4000-8000-000000000006';

UPDATE purchases
SET receipt_token = '436c53f08ab3bba80f8f3aefc3326dd496b7c585cbf3b0efbcc2d8b8a7db6b98'
WHERE id = '10000000-0000-4000-8000-000000000014';

UPDATE purchases
SET receipt_token = '7aa8855753e6fa1ff748fbfd3c7c3dffa68f0688fd223a30dd561d1e419b1808'
WHERE id = '10000000-0000-4000-8000-000000000040';

CREATE UNIQUE INDEX idx_purchases_receipt_token ON purchases (receipt_token);
