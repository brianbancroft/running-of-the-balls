-- Each purchase has an unguessable receipt link. Email is not a public lookup key.
-- The six tokens below are fixtures for the seeded demo rows so the local
-- purchase page stays clickable. They are not credentials. A purchase made
-- through the app gets a fresh random token instead.

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
