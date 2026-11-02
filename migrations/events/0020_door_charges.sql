-- The rest of a multi-day event's schedule, as JSON: [{ date, startTime, endTime }]. date, startTime and endTime stay the first day.
ALTER TABLE events ADD COLUMN moreDays TEXT NOT NULL DEFAULT '[]';
-- The last scheduled day when there is more than one, kept from moreDays so a date search can find the event; empty for one day.
ALTER TABLE events ADD COLUMN lastDate TEXT NOT NULL DEFAULT '';
-- An event's ticket types as JSON: [{ id, name, price, days }], with price in dollars like "7.50". They replace studentPrice and generalPrice, which nothing reads anymore.
ALTER TABLE events ADD COLUMN tickets TEXT NOT NULL DEFAULT '[]';
UPDATE events SET tickets = json_array(json_object('id', 'student', 'name', 'Student', 'price', studentPrice, 'days', 1), json_object('id', 'general', 'name', 'General', 'price', generalPrice, 'days', 1)) WHERE studentPrice != '' AND generalPrice != '';
UPDATE events SET tickets = json_array(json_object('id', 'student', 'name', 'Student', 'price', studentPrice, 'days', 1)) WHERE studentPrice != '' AND generalPrice = '';
UPDATE events SET tickets = json_array(json_object('id', 'general', 'name', 'General', 'price', generalPrice, 'days', 1)) WHERE studentPrice = '' AND generalPrice != '';
-- One row per ticket bought at the door. status is pending until it is paid (card, cash, free or waived), or canceled if they paid another way. days is how many days the ticket covers. tappedAt and callbackAt record that someone went to Square and came back.
CREATE TABLE door_charges (id TEXT PRIMARY KEY, eventId TEXT NOT NULL, sessionDate TEXT NOT NULL, email TEXT NOT NULL, attendee TEXT NOT NULL, ticketName TEXT NOT NULL, amount INTEGER NOT NULL, days INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', paymentId TEXT, tappedAt TEXT, callbackAt TEXT, createdAt TEXT NOT NULL, settledAt TEXT);
CREATE UNIQUE INDEX door_charges_pending ON door_charges (eventId, email) WHERE status = 'pending';
CREATE INDEX door_charges_tickets ON door_charges (eventId, email, status);
CREATE INDEX door_charges_queue ON door_charges (status, createdAt);
-- The days a ticket has been checked in on.
CREATE TABLE door_ticket_days (chargeId TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (chargeId, date));
