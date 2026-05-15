ALTER TABLE email_codes DROP CONSTRAINT IF EXISTS email_codes_type_check;
ALTER TABLE email_codes ADD CONSTRAINT email_codes_type_check
  CHECK (type IN ('verification', 'password_reset', 'password_change'));
