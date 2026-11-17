-- Doodad's receiving service (Doodad repo: docs/27, D115, D131). Nothing
-- here holds an IP address, a user agent, a location, or an ID: the app
-- sends none, and the Worker never reads them from the request.

-- Installs, only ever counted: one row per day, version and kind of
-- computer, with how many. An install can't be told from another.
CREATE TABLE installs (
  day       TEXT NOT NULL,   -- UTC day the report arrived, YYYY-MM-DD
  week      TEXT NOT NULL,   -- the install week it carried, like 2026-W47
  version   TEXT NOT NULL,
  channel   TEXT NOT NULL,
  os        TEXT NOT NULL,
  os_major  TEXT NOT NULL,
  arch      TEXT NOT NULL,
  count     INTEGER NOT NULL,
  PRIMARY KEY (day, week, version, channel, os, os_major, arch)
);

-- Reports and feedback sent by hand, exactly as checked.
CREATE TABLE reports (
  id         INTEGER PRIMARY KEY,
  received   TEXT NOT NULL,  -- UTC day, YYYY-MM-DD (not the time)
  kind       TEXT NOT NULL CHECK (kind IN ('problem', 'crash', 'feedback')),
  version    TEXT NOT NULL,
  body       TEXT NOT NULL
);
CREATE INDEX reports_by_kind ON reports (kind, received);

-- Weekly usage stats (opt-in), failed changes given by hand, and alpha
-- diagnostics: kept as checked, by the day they arrived.
CREATE TABLE usage_reports (
  id       INTEGER PRIMARY KEY,
  received TEXT NOT NULL,
  week     TEXT NOT NULL,
  body     TEXT NOT NULL
);

CREATE TABLE donations (
  id       INTEGER PRIMARY KEY,
  received TEXT NOT NULL,
  body     TEXT NOT NULL
);

CREATE TABLE incidents (
  id       INTEGER PRIMARY KEY,
  received TEXT NOT NULL,
  kind     TEXT NOT NULL,
  body     TEXT NOT NULL
);
