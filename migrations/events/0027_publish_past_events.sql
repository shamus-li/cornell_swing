-- Past events aren't drafts. The website leaves out earlier academic years by date.
UPDATE events SET published = 1 WHERE id IN ('special-2024-11-09', 'special-2024-12-12', 'special-2025-04-19', 'special-2025-09-20', 'special-2025-11-08', 'special-2026-03-13');
