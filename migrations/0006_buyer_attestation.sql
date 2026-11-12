-- A confirmed purchase stores the buyer's attestation that they are 19 or older
-- and physically in British Columbia. An offline sale stores the same facts
-- as entered by an admin.
-- Seeded fixture rows keep the defaults (0 and NULL). They were not collected
-- from a buyer. The application refuses a new confirmed purchase unless both
-- flags are 1.

ALTER TABLE purchases ADD COLUMN attested_age_19 INTEGER NOT NULL DEFAULT 0 CHECK (attested_age_19 IN (0, 1));
ALTER TABLE purchases ADD COLUMN attested_in_bc INTEGER NOT NULL DEFAULT 0 CHECK (attested_in_bc IN (0, 1));
ALTER TABLE purchases ADD COLUMN attested_at TEXT;
ALTER TABLE purchases ADD COLUMN attested_by TEXT CHECK (attested_by IS NULL OR attested_by IN ('buyer', 'admin'));
ALTER TABLE purchases ADD COLUMN attestation_text TEXT;
