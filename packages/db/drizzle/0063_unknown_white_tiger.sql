ALTER TABLE "tasks" ADD COLUMN "workflow_type" text DEFAULT 'rpi' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "worktree_timing" text DEFAULT 'later' NOT NULL;