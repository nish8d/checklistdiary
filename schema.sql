-- Each user's fixed daily checklist: {"do": [...], "dont": [...]}
CREATE TABLE IF NOT EXISTS templates (
  user TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- One saved day per user: items = [{text, type, checked}], plus the note
CREATE TABLE IF NOT EXISTS entries (
  user     TEXT NOT NULL,
  date     TEXT NOT NULL,          -- YYYY-MM-DD
  items    TEXT NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  saved_at TEXT NOT NULL,
  PRIMARY KEY (user, date)
);
CREATE INDEX IF NOT EXISTS entries_date ON entries (date);
