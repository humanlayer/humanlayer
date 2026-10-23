ALTER TABLE "artifacts" ADD COLUMN "share_key" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "shared_by" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "share_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_share_key_unique" UNIQUE("share_key");