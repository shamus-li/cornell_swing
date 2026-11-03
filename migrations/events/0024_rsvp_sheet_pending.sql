-- 1 while an RSVP is saved here but not yet confirmed on the connected Google Sheet.
ALTER TABLE rsvps ADD COLUMN sheetPending INTEGER NOT NULL DEFAULT 0;
