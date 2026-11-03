-- Other groups' events use the same names as Swing Syndicate's: location for venue, and published for status. needsReview marks one waiting for an organizer.
ALTER TABLE outside_events RENAME COLUMN venue TO location;
ALTER TABLE outside_events ADD COLUMN published INTEGER NOT NULL DEFAULT 1;
ALTER TABLE outside_events ADD COLUMN needsReview INTEGER NOT NULL DEFAULT 0;
UPDATE outside_events SET published = status = 'published', needsReview = status = 'review';
DROP INDEX outside_events_status;
ALTER TABLE outside_events DROP COLUMN status;
CREATE INDEX outside_events_published ON outside_events(published, date, startTime);
-- Swing Syndicate's events get the dance styles and city other groups' already have.
ALTER TABLE events ADD COLUMN styles TEXT NOT NULL DEFAULT '["Swing"]';
ALTER TABLE events ADD COLUMN city TEXT NOT NULL DEFAULT 'Ithaca';
-- Replaced by tickets in 0020.
ALTER TABLE events DROP COLUMN studentPrice;
ALTER TABLE events DROP COLUMN generalPrice;
