ALTER TABLE "organization_settings" ADD COLUMN "multiplayer_prompting_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "multiplayer_prompting_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "multiplayer_prompting_started_at" bigint;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "multiplayer_prompting_expires_at" bigint;