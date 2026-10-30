CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  alertEmail TEXT NOT NULL
);
INSERT INTO settings (id, alertEmail) VALUES (1, 'wl757@cornell.edu');
