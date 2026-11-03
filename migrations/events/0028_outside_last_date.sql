-- Other groups' events running several days show their dates instead of times.
ALTER TABLE outside_events ADD COLUMN lastDate TEXT NOT NULL DEFAULT '';
UPDATE outside_events SET title = 'Stompology Solo Jazz Weekend', lastDate = '2026-11-22', startTime = '', endTime = '' WHERE id = 'stompology-2026';
UPDATE outside_events SET title = 'Golden Celebration Weekend', lastDate = '2026-11-29', startTime = '', endTime = '' WHERE id = 'cdr-golden-2026';
