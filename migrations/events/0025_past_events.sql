-- Past events from the Balance Sheet, unpublished so they stay off the public site. attendance is the headcount
-- from before check-ins named their event. The year in two titles keeps Sweater Weather Swing unique for the RSVP sheet.
ALTER TABLE events ADD COLUMN attendance INTEGER;
INSERT OR IGNORE INTO events (id, kind, title, date, moreDays, lastDate, updatedAt, published, attendance) VALUES
  ('special-2024-11-09', 'special', 'Sweater Weather Swing 2024', '2024-11-09', '[{"date":"2024-11-10","startTime":"","endTime":""}]', '2024-11-10', '2026-11-03T00:00:00.000Z', 0, 60),
  ('special-2024-12-12', 'special', 'CU Jazz Event', '2024-12-12', '[]', '', '2026-11-03T00:00:00.000Z', 0, NULL),
  ('special-2025-04-19', 'special', 'Lindy Bloom', '2025-04-19', '[{"date":"2025-04-20","startTime":"","endTime":""}]', '2025-04-20', '2026-11-03T00:00:00.000Z', 0, 62),
  ('special-2025-09-20', 'special', 'Back-2-Skool Swing', '2025-09-20', '[]', '', '2026-11-03T00:00:00.000Z', 0, 30),
  ('special-2025-11-08', 'special', 'Sweater Weather Swing 2025', '2025-11-08', '[{"date":"2025-11-09","startTime":"","endTime":""}]', '2025-11-09', '2026-11-03T00:00:00.000Z', 0, 51),
  ('special-2026-03-13', 'special', 'Pre-Spring Swing Fling', '2026-03-13', '[]', '', '2026-11-03T00:00:00.000Z', 0, NULL);
