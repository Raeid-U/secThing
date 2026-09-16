ALTER TABLE companies
  ADD COLUMN sic_description text,
  ADD COLUMN entity_type text,
  ADD COLUMN state_of_incorporation text,
  ADD COLUMN state_of_incorporation_description text,
  ADD COLUMN business_address jsonb,
  ADD COLUMN mailing_address jsonb,
  ADD COLUMN phone text;
