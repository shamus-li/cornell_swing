-- Each event's address, /events/slug. event_slugs keeps every slug an event has had, so links already shared
-- still work after a rename; events.slug is the current one.
ALTER TABLE events ADD COLUMN slug TEXT;
CREATE TABLE event_slugs (
  slug TEXT PRIMARY KEY,
  eventId TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE
);
UPDATE events SET slug = lower(replace(trim(replace(title, '👻', '')), ' ', '-')) || CASE WHEN (kind = 'normal' OR title = 'TBA') AND date != '' THEN '-' || substr('janfebmaraprmayjunjulaugsepoctnovdec', substr(date, 6, 2) * 3 - 2, 3) || '-' || cast(substr(date, 9, 2) AS INTEGER) ELSE '' END;
INSERT OR IGNORE INTO event_slugs (slug, eventId) SELECT slug, id FROM events;
