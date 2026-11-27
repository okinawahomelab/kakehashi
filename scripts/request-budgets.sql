CREATE TABLE IF NOT EXISTS request_budgets (
  client TEXT NOT NULL,
  minute INTEGER NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (client, minute)
);

CREATE INDEX IF NOT EXISTS request_budgets_minute ON request_budgets (minute);

CREATE TABLE IF NOT EXISTS youtube_search_quota (
  day INTEGER PRIMARY KEY,
  used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_other_quota (
  hour INTEGER PRIMARY KEY,
  used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instagram_discovery_quota (
  hour INTEGER PRIMARY KEY,
  used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS social_search_quota (
  month TEXT PRIMARY KEY,
  used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instagram_search_cache (
  query_hash TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  items TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS instagram_search_cache_expires ON instagram_search_cache (expires);

CREATE TABLE IF NOT EXISTS instagram_search_inflight (
  query_hash TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS searx_search_quota (
  day INTEGER PRIMARY KEY,
  used INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exa_search_quota (
  day INTEGER PRIMARY KEY,
  used INTEGER NOT NULL
);
