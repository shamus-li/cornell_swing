-- When a weekly night's lesson ends and its social dance begins; empty when the night has no lesson.
ALTER TABLE events ADD COLUMN lessonEndTime TEXT NOT NULL DEFAULT '';
-- Lessons so far took the first hour of the night.
UPDATE events SET lessonEndTime = strftime('%H:%M', startTime, '+60 minutes')
WHERE kind = 'normal' AND startTime != '' AND endTime > strftime('%H:%M', startTime, '+60 minutes');
