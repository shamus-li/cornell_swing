-- Square replaces the Venmo email feed, which missed most payments. Both Venmo tables were never filled.
DROP TABLE venmo_payments;
DROP TABLE gmail_connection;

-- The Square account an officer connected. Access tokens last 30 days and are renewed with the refresh token.
CREATE TABLE square_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  merchantId TEXT NOT NULL,
  name TEXT NOT NULL,
  accessToken TEXT NOT NULL,
  refreshToken TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  syncedAt TEXT NOT NULL
);

-- Completed Square payments. amount is net of refunds and fee is Square's processing fee, both in cents.
-- synced is 0 until the Ledger has the payment's current amounts.
CREATE TABLE square_payments (
  id TEXT PRIMARY KEY,
  paidAt TEXT NOT NULL,
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  cash INTEGER NOT NULL,
  note TEXT NOT NULL,
  eventId TEXT,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX square_payments_paid ON square_payments(paidAt);
