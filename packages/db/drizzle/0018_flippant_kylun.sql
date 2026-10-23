ALTER TABLE "tasks" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "resource_owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "approved_by_user_id" text;