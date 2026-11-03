-- Fake events for staging. Apply with: wrangler d1 execute swing-events-staging --config wrangler.staging.jsonc --remote --file scripts/staging-seed.sql
DELETE FROM door_ticket_days;
DELETE FROM door_charges;
DELETE FROM square_payments;
DELETE FROM events;
INSERT INTO events (id, kind, title, date, startTime, endTime, moreDays, lastDate, location, room, description, tickets, published, updatedAt) VALUES
('staging-test-week', 'special', 'Staging test week', '2026-11-02', '00:00', '23:59',
 '[{"date":"2026-11-03","startTime":"00:00","endTime":"23:59"},{"date":"2026-11-04","startTime":"00:00","endTime":"23:59"},{"date":"2026-11-05","startTime":"00:00","endTime":"23:59"},{"date":"2026-11-06","startTime":"00:00","endTime":"23:59"},{"date":"2026-11-07","startTime":"00:00","endTime":"23:59"},{"date":"2026-11-08","startTime":"00:00","endTime":"23:59"},{"date":"2026-11-09","startTime":"00:00","endTime":"23:59"}]',
 '2026-11-09', 'Test Hall', 'Test Room', 'Fake event that runs all day, so any check-in this week finds it.',
 '[{"id":"student","name":"Student","price":"1","days":1},{"id":"general","name":"General","price":"2","days":1},{"id":"pass","name":"Two-day pass","price":"3","days":2},{"id":"free","name":"Free guest","price":"0","days":1}]',
 1, '2026-11-03T00:00:00.000Z'),
('staging-one-day', 'special', 'Staging one-day dance', '2026-11-13', '18:15', '22:00', '[]', '', 'Test Hall', 'Test Room', 'Fake one-day event with the usual two tickets.',
 '[{"id":"student","name":"Student","price":"10","days":1},{"id":"general","name":"General","price":"15","days":1}]',
 1, '2026-11-03T00:00:00.000Z');
