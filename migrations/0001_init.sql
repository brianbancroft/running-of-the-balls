-- Demo schema for Running of the Balls.
-- Payment mode is constrained to the fake Stripe test marker. demo_only cannot
-- be turned off without a deliberate schema change. Nothing here stores a
-- card, a live charge, or a draw result.

CREATE TABLE balls (
  id INTEGER PRIMARY KEY,
  ball_number INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'selected', 'sold')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY,
  buyer_email TEXT NOT NULL,
  buyer_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('demo_pending', 'demo_confirmed', 'cancelled')),
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('stripe_test_fake', 'offline_demo')),
  stripe_test_reference TEXT,
  offline_note TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 100000),
  currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  demo_only INTEGER NOT NULL DEFAULT 1 CHECK (demo_only = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (
      payment_mode = 'offline_demo'
      AND offline_note IS NOT NULL
      AND stripe_test_reference IS NULL
    )
    OR (
      payment_mode = 'stripe_test_fake'
      AND offline_note IS NULL
    )
  )
);

-- Email plus the ball that buyer selected. Kept even if the hold is cancelled
-- so the link between an address and a ball stays auditable.
CREATE TABLE ball_selections (
  id TEXT PRIMARY KEY,
  ball_id INTEGER NOT NULL REFERENCES balls (id),
  email TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES purchases (id),
  created_at TEXT NOT NULL
);

CREATE TABLE email_dispatches (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases (id),
  selection_id TEXT NOT NULL REFERENCES ball_selections (id),
  to_email TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'resend')),
  status TEXT NOT NULL CHECK (status IN ('previewed', 'sent', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_balls_status ON balls (status);
CREATE INDEX idx_purchases_email ON purchases (buyer_email);
CREATE INDEX idx_ball_selections_email ON ball_selections (email);
CREATE INDEX idx_ball_selections_purchase ON ball_selections (purchase_id);
CREATE INDEX idx_email_dispatches_purchase ON email_dispatches (purchase_id);
