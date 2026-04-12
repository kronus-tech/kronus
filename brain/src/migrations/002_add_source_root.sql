-- v5.5: Add source_root column to track which root each note came from
-- Values: 'personal' (~/second-brain) or 'project' (~/.claude/projects/*)

ALTER TABLE nodes ADD COLUMN source_root TEXT NOT NULL DEFAULT 'personal';
CREATE INDEX IF NOT EXISTS idx_nodes_source_root ON nodes(source_root);

-- Update schema version
INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '2');
