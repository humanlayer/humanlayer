ALTER TABLE "task_user_settings" ADD COLUMN "workspace_base_directory" text;--> statement-breakpoint
ALTER TABLE "task_user_settings" ADD COLUMN "workspace_materialized_at" bigint;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workspace_state" jsonb;