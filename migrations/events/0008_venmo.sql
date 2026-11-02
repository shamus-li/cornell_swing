-- One row per Venmo transaction the Gmail script has sent. Personal payments keep only their ID, so
-- a resent email is recognized without storing who paid whom.
CREATE TABLE venmo_payments (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  name TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  paidAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('review', 'club', 'personal')),
  eventId TEXT,
  category TEXT NOT NULL DEFAULT '',
  synced INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX venmo_payments_status ON venmo_payments(status, paidAt);
