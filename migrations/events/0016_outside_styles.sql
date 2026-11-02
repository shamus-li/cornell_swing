-- An event can have several dance styles, such as a contra and swing dance. styles is a JSON array of names.
ALTER TABLE outside_events ADD COLUMN styles TEXT NOT NULL DEFAULT '[]';
UPDATE outside_events SET styles = json_array(style);
ALTER TABLE outside_events DROP COLUMN style;
