CREATE TABLE IF NOT EXISTS research_requests(id TEXT PRIMARY KEY,plant TEXT NOT NULL,name TEXT NOT NULL,location TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_research ON research_requests(plant) WHERE status IN ('awaiting_key','queued','discovering','collecting','synthesizing');
CREATE INDEX IF NOT EXISTS research_status ON research_requests(status,updated_at);
