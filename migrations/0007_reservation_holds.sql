-- Reservation holds. Selecting a ball is pending payment, not a sale.
-- reservation_sessions.created_at is the first successful hold in that browser.
-- expires_at is five minutes later and is copied onto every hold in the session.
-- A hold moves pending_payment -> confirmed (paid), released (left behind or
-- removed), or expired (the window passed). Expired rows stay for the audit.

CREATE TABLE reservation_sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'expired'))
);

CREATE TABLE ball_holds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES reservation_sessions (id),
  ball_id INTEGER NOT NULL REFERENCES balls (id),
  state TEXT NOT NULL CHECK (state IN ('pending_payment', 'confirmed', 'released', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  purchase_id TEXT REFERENCES purchases (id),
  released_at TEXT
);

CREATE INDEX idx_ball_holds_session ON ball_holds (session_id, state);
CREATE INDEX idx_ball_holds_expiry ON ball_holds (state, expires_at);
CREATE UNIQUE INDEX idx_ball_holds_one_pending ON ball_holds (ball_id) WHERE state = 'pending_payment';
