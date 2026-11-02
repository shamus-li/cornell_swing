-- When a weekly night's social dance starts, so it can overlap the lesson; empty when the night has no lesson and the dance starts at startTime.
ALTER TABLE events ADD COLUMN socialStartTime TEXT NOT NULL DEFAULT '';
-- Social dances so far started when the lesson ended.
UPDATE events SET socialStartTime = lessonEndTime WHERE lessonEndTime != '';
