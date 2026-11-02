-- Calendar feeds that keep other groups' events up to date. feedUrl is a calendar (.ics) link, a Squarespace
-- events page with ?format=json, or a club's CampusGroups page, whose events come from the shared Cornell calendar.
-- Events from a feed take the group's style and skip titles containing any comma-separated word in skipTitles.
ALTER TABLE dance_groups ADD COLUMN style TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE dance_groups ADD COLUMN feedUrl TEXT NOT NULL DEFAULT '';
ALTER TABLE dance_groups ADD COLUMN skipTitles TEXT NOT NULL DEFAULT '';
ALTER TABLE dance_groups ADD COLUMN checkedAt TEXT;
ALTER TABLE dance_groups ADD COLUMN feedError TEXT;
-- The feed's id for the event, so each reading updates it in place. Typed-in events have none.
ALTER TABLE outside_events ADD COLUMN sourceId TEXT;
CREATE UNIQUE INDEX outside_events_source ON outside_events(groupId, sourceId);

INSERT INTO dance_groups (id, name, style, feedUrl, skipTitles) VALUES
  ('ithaca-swing-dance-network', 'Ithaca Swing Dance Network', 'Swing', 'https://ithacaswing.org/events.ics', ''),
  ('hands-four', 'Hands Four', 'Contra', 'https://www.hands4dancers.org/upcoming-dances?format=json', ''),
  ('cornell-contra-dance-club', 'Cornell Contra Dance Club', 'Contra', 'https://cornell.campusgroups.com/CornellContraDanceClub', ''),
  ('dancesport-at-cornell', 'DanceSport at Cornell', 'Ballroom', 'https://cornell.campusgroups.com/DanceSport', 'Practice, Rounds, Coaching, Competition, Inferno'),
  ('tango-at-cornell', 'Tango at Cornell', 'Tango', 'https://cornell.campusgroups.com/IthTan', 'Practice, Class'),
  ('sabor-latino', 'Sabor Latino Dance Ensemble', 'Salsa', 'https://cornell.campusgroups.com/SaborLatino', 'Practice, Workshop, Concert, Audition'),
  ('proyecto-palante', 'Proyecto Palante', 'Salsa', 'https://cornell.campusgroups.com/PalanteGrad', '')
ON CONFLICT (name) DO UPDATE SET style = excluded.style, feedUrl = excluded.feedUrl, skipTitles = excluded.skipTitles;
