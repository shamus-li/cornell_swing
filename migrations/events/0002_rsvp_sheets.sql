CREATE TABLE rsvp_sheet_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  spreadsheetId TEXT NOT NULL,
  sheetId INTEGER NOT NULL,
  tabTitle TEXT NOT NULL,
  syncedThrough INTEGER NOT NULL DEFAULT 0,
  lastSyncedAt TEXT,
  error TEXT
);
CREATE TABLE rsvp_sheet_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eventId TEXT NOT NULL,
  email TEXT NOT NULL,
  UNIQUE (eventId, email),
  FOREIGN KEY (eventId, email) REFERENCES rsvps(eventId, email) ON DELETE CASCADE
);
INSERT INTO rsvp_sheet_rows (eventId, email)
SELECT eventId, email FROM rsvps ORDER BY createdAt, eventId, email;
