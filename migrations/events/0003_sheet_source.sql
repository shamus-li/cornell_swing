ALTER TABLE rsvp_sheet_connection ADD COLUMN lockToken TEXT;
ALTER TABLE rsvp_sheet_connection ADD COLUMN lockUntil INTEGER NOT NULL DEFAULT 0;
DROP TABLE rsvp_sheet_rows;
ALTER TABLE events ADD COLUMN locationUrl TEXT NOT NULL DEFAULT '';
