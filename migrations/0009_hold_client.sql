-- Unpaid-hold limits. client_key is a short hash of the network address
-- Cloudflare provides. It is not the raw address.
-- A reservation can have 40 pending holds. One client_key can have 120
-- pending holds, counting reservation holds and optional demo_pending
-- purchases together.
-- Rows with no client_key, including the seeded sample holds, are not
-- counted and are not swept when an optional hold passes five minutes.

ALTER TABLE reservation_sessions ADD COLUMN client_key TEXT;
ALTER TABLE purchases ADD COLUMN client_key TEXT;

CREATE INDEX idx_reservation_sessions_client_key ON reservation_sessions (client_key);
CREATE INDEX idx_purchases_client_key ON purchases (client_key);
