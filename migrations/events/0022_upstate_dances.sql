-- Dance groups within a two-hour drive of Ithaca with calendar feeds.
INSERT INTO dance_groups (id, name, style, city, feedUrl, skipTitles) VALUES
  ('groove-juice-swing', 'Groove Juice Swing', 'Swing', 'Rochester', 'https://calendar.google.com/calendar/ical/groovejuiceswing.com_b46dvqfj6ledkd9mncjjm6a1e8%40group.calendar.google.com/public/basic.ics', 'Intro to, Improver, Routine, Practice, Cardio, Cancelled, Class, Online, Swing 1, Swing 2, Swing 3, Balboa 1, Balboa 2, Balboa 3, Stompology'),
  ('syracuse-country-dancers', 'Syracuse Country Dancers', 'Contra', 'Syracuse', 'https://syracusecountrydancers.org/events.ics', 'No Dance'),
  ('syracuse-social', 'Syracuse Social', 'West Coast Swing', 'Syracuse', 'https://calendar.google.com/calendar/ical/syracusesocialcommunity%40gmail.com/public/basic.ics', 'Lesson, Team Practice, Volunteer-Only, Westie Lab, goes to, Cancelled'),
  ('southern-tier-swing', 'Southern Tier Swing Dance Society', 'Swing', 'Binghamton', 'https://calendar.google.com/calendar/ical/81h767o9pr8bajob6frki0o4k4%40group.calendar.google.com/public/basic.ics', 'Lesson, Canfield, Cha-Cha')
ON CONFLICT (name) DO UPDATE SET style = excluded.style, city = excluded.city, feedUrl = excluded.feedUrl, skipTitles = excluded.skipTitles;
UPDATE dance_groups SET siteUrl = 'https://www.groovejuiceswing.com/' WHERE id = 'groove-juice-swing';
UPDATE dance_groups SET siteUrl = 'https://syracusecountrydancers.org/' WHERE id = 'syracuse-country-dancers';
UPDATE dance_groups SET siteUrl = 'https://www.syracusesocialdance.com/' WHERE id = 'syracuse-social';
UPDATE dance_groups SET siteUrl = 'https://www.stnyswingdance.info/' WHERE id = 'southern-tier-swing';

-- Groups without feeds. These dates came from their sites on Nov 2, 2026.
INSERT INTO dance_groups (id, name, style, city) VALUES
  ('flx-squares', 'FLX Squares', 'Square', 'Newfield'),
  ('country-dancers-rochester', 'Country Dancers of Rochester', 'Contra', 'Rochester'),
  ('rocsalsa', 'RocSalsa', 'Salsa', 'Rochester'),
  ('stompology', 'Stompology', 'Swing', 'Rochester')
ON CONFLICT (name) DO NOTHING;
INSERT INTO outside_events (id, groupId, title, date, startTime, endTime, venue, city, styles, price, url, status, updatedAt, sourceNote) VALUES
  ('stompology-2026', 'stompology', 'Stompology Solo Jazz Weekend, Nov 20–22', '2026-11-20', '19:15', '', 'Historic German House, 315 Gregory St', 'Rochester', '["Swing"]', 'All-in pass from $180', 'https://stompology.com/', 'published', '2026-11-03T00:00:00.000Z', ''),
  ('flx-2026-12-18', 'flx-squares', 'Community Square Dance at Stone Bend', '2026-12-18', '18:30', '', 'Stone Bend Farm', 'Newfield', '["Square"]', '$10, no one turned away', 'https://www.flxsquares.com/events/community-square-dance-at-stone-bend-dec-2026/', 'published', '2026-11-02T00:00:00.000Z', ''),
  ('cdr-2026-11-05', 'country-dancers-rochester', 'Contra Dance', '2026-11-05', '19:00', '22:00', 'The Rose Room, 295 Gregory St', 'Rochester', '["Contra"]', 'Pay what you can, $12 suggested', 'https://cdrochester.org/events', 'published', '2026-11-02T00:00:00.000Z', ''),
  ('cdr-2026-11-08', 'country-dancers-rochester', 'English Country Dance', '2026-11-08', '14:30', '17:30', 'First Rochester Baptist Church', 'Rochester', '["English Country"]', '', 'https://cdrochester.org/events', 'published', '2026-11-02T00:00:00.000Z', ''),
  ('cdr-2026-11-15', 'country-dancers-rochester', 'English Country Dance', '2026-11-15', '14:30', '17:30', 'First Rochester Baptist Church', 'Rochester', '["English Country"]', '', 'https://cdrochester.org/events', 'published', '2026-11-02T00:00:00.000Z', ''),
  ('cdr-2026-11-22', 'country-dancers-rochester', 'English Country Dance', '2026-11-22', '14:30', '17:30', 'First Rochester Baptist Church', 'Rochester', '["English Country"]', '', 'https://cdrochester.org/events', 'published', '2026-11-02T00:00:00.000Z', ''),
  ('rocsalsa-2026-11-08', 'rocsalsa', 'Latin Salsa Dance Social', '2026-11-08', '19:00', '21:00', 'The Clover Center, 1101 Clover St', 'Rochester', '["Salsa"]', '$5', 'https://www.salsavida.com/event/new-york/rochester/latin-salsa-dance-social-every-sunday/', 'review', '2026-11-02T00:00:00.000Z', ''),
  ('rocsalsa-2026-11-15', 'rocsalsa', 'Latin Salsa Dance Social', '2026-11-15', '19:00', '21:00', 'The Clover Center, 1101 Clover St', 'Rochester', '["Salsa"]', '$5', 'https://www.salsavida.com/event/new-york/rochester/latin-salsa-dance-social-every-sunday/', 'review', '2026-11-02T00:00:00.000Z', '');

-- This dance was read from its feed as contra only.
UPDATE outside_events SET styles = '["Swing","Contra"]' WHERE title LIKE '%Contra%Swing%';
