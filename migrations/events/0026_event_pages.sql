-- Pages for a group's recurring events that its calendar feed doesn't link to, used on each reading of the feed.
ALTER TABLE dance_groups ADD COLUMN eventPages TEXT NOT NULL DEFAULT '';
UPDATE dance_groups SET eventPages = 'Lindy Jam https://www.groovejuiceswing.com/events/rochester-lindy-jam.aspx' WHERE id = 'groove-juice-swing';
UPDATE dance_groups SET eventPages = 'Westie Wednesday https://syracusesocialdance.com/westie-wednesday' WHERE id = 'syracuse-social';
UPDATE outside_events SET url = 'https://www.groovejuiceswing.com/events/rochester-lindy-jam.aspx' WHERE groupId = 'groove-juice-swing' AND sourceId IS NOT NULL AND title LIKE '%Lindy Jam%';
UPDATE outside_events SET url = 'https://syracusesocialdance.com/westie-wednesday' WHERE groupId = 'syracuse-social' AND sourceId IS NOT NULL AND title LIKE '%Westie Wednesday%';
-- Typed-in Country Dancers of Rochester dances that linked to its whole calendar.
UPDATE outside_events SET url = 'https://cdrochester.org/events/thursday-night-contra-316' WHERE id = 'cdr-2026-11-05';
UPDATE outside_events SET url = 'https://cdrochester.org/events/english-country-dance-62' WHERE id = 'cdr-2026-11-08';
UPDATE outside_events SET url = 'https://cdrochester.org/events/english-country-dance-63' WHERE id = 'cdr-2026-11-15';
UPDATE outside_events SET url = 'https://cdrochester.org/events/english-country-dance-64' WHERE id = 'cdr-2026-11-22';
