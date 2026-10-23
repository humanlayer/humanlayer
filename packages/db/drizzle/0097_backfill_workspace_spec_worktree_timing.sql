-- Data-only repair for tasks created with an immediate workspace spec but persisted with the
-- default deferred timing. Workspace setup and multi-host launch both treat a spec as worktree-now.
UPDATE "tasks"
SET "worktree_timing" = 'now'
WHERE "workspace_spec" IS NOT NULL
  AND "worktree_timing" IS DISTINCT FROM 'now';
