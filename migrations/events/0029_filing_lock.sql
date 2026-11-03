-- Held while the site writes to the Balance Sheet, so two writers can't claim the same new row.
CREATE TABLE filing_lock (id INTEGER PRIMARY KEY CHECK (id = 1), until TEXT NOT NULL);
