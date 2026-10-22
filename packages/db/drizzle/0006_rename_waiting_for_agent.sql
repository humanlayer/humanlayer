-- Migrate existing sessions from waiting_for_agent to resuming
UPDATE sessions SET status = 'resuming' WHERE status = 'waiting_for_agent';
