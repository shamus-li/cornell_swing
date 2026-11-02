-- Where an event waiting for review came from, such as a visitor's request on /events, shown to organizers.
ALTER TABLE outside_events ADD COLUMN sourceNote TEXT NOT NULL DEFAULT '';
