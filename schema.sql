-- pxd D1 schema

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,          -- pxk8f3m2n
  name TEXT NOT NULL,           -- human label
  meta TEXT,                    -- JSON blob, freeform
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- github, obsidian, cf, etc
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_tag_id ON links(tag_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
