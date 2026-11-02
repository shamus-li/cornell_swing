-- Dances run by other groups, listed on /events beside Swing Syndicate's own events.
CREATE TABLE dance_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
-- status is "review" for events waiting on an organizer, "published" for events on /events, and
-- "hidden" for drafts and events an organizer removed.
CREATE TABLE outside_events (
  id TEXT PRIMARY KEY,
  groupId TEXT NOT NULL REFERENCES dance_groups(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  startTime TEXT NOT NULL DEFAULT '',
  endTime TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL,
  price TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('review', 'published', 'hidden')),
  updatedAt TEXT NOT NULL
);
CREATE INDEX outside_events_status ON outside_events(status, date, startTime);
