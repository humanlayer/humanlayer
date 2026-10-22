ALTER TABLE "approvals" ALTER COLUMN "resource_owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_events" ALTER COLUMN "resource_owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "resource_owner_user_id" SET NOT NULL;