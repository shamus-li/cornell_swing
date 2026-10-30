-- Organizers' saved edits to the newsletter parts that repeat every week, such as the sign-off and footer.
CREATE TABLE newsletter_template (
  part TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
