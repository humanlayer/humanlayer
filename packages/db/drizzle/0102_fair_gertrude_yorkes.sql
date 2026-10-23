UPDATE "organization_settings" SET "default_task_share_level" = 'edit' WHERE "default_task_share_level" = 'read';--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_task_share_level" SET DEFAULT 'edit';
