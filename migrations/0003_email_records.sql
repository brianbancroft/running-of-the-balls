-- Keep the buyer receipt itself beside the ball it belongs to.
-- A dry run still inserts this row; it just does not call Resend.

ALTER TABLE email_dispatches ADD COLUMN ball_id INTEGER;
ALTER TABLE email_dispatches ADD COLUMN subject TEXT;
ALTER TABLE email_dispatches ADD COLUMN text_body TEXT;
ALTER TABLE email_dispatches ADD COLUMN html_body TEXT;

CREATE INDEX idx_email_dispatches_ball ON email_dispatches (ball_id);
CREATE INDEX idx_email_dispatches_to ON email_dispatches (to_email);
