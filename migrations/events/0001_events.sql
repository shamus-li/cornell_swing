CREATE TABLE events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('normal', 'special')),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  startTime TEXT NOT NULL DEFAULT '',
  endTime TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL
);
CREATE INDEX events_date ON events(date, startTime);
CREATE TABLE rsvps (
  eventId TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  PRIMARY KEY (eventId, email)
);
