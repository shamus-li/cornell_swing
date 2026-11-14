-- The member a door charge is for, since people can share an email. A first-timer has none until they check in, so their pending charge is known by email.
ALTER TABLE door_charges ADD COLUMN memberId TEXT;
UPDATE door_charges SET memberId = json_extract(attendee, '$.memberId');
DROP INDEX door_charges_pending;
CREATE UNIQUE INDEX door_charges_pending ON door_charges (eventId, COALESCE(memberId, email)) WHERE status = 'pending';
DROP INDEX door_charges_tickets;
CREATE INDEX door_charges_tickets ON door_charges (eventId, COALESCE(memberId, email), status);
