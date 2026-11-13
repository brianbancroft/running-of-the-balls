-- An admin can void a mistaken demo sale. The purchase row is kept.
-- status stays demo_confirmed: that column's check cannot be rebuilt while
-- ball_selections, email_dispatches, and ball_holds reference purchases.
-- voided_at is the void. The API shows the purchase as voided when it is set.
-- The ball goes back to available in the same batch as the audit row.
-- This is not a refund. The demo never took money.

ALTER TABLE purchases ADD COLUMN voided_at TEXT;
ALTER TABLE purchases ADD COLUMN void_reason TEXT;
ALTER TABLE purchases ADD COLUMN voided_by TEXT;

CREATE TABLE sale_voids (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases (id),
  ball_id INTEGER NOT NULL REFERENCES balls (id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  voided_by TEXT NOT NULL CHECK (length(trim(voided_by)) > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sale_voids_purchase ON sale_voids (purchase_id);
CREATE INDEX idx_sale_voids_ball ON sale_voids (ball_id);
CREATE INDEX idx_purchases_voided_at ON purchases (voided_at);
