-- The city each dance is in, now that the calendar reaches beyond Ithaca. A group's city is the default for its feed's events.
ALTER TABLE dance_groups ADD COLUMN city TEXT NOT NULL DEFAULT 'Ithaca';
ALTER TABLE outside_events ADD COLUMN city TEXT NOT NULL DEFAULT 'Ithaca';
-- A group's website, the link for feed events that don't have their own.
ALTER TABLE dance_groups ADD COLUMN siteUrl TEXT NOT NULL DEFAULT '';
