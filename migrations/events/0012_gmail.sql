-- The Gmail account that receives Venmo's payment emails, connected from the Finances tab. cursor is
-- the time, in seconds, of the newest email already read.
CREATE TABLE gmail_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  refreshToken TEXT NOT NULL,
  cursor INTEGER NOT NULL
);
