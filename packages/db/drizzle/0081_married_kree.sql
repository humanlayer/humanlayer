ALTER TABLE "organization_settings" ADD COLUMN "commit_tracking_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "pr_tracking_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "metrics_advanced_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "metrics_advanced_self_serve" boolean DEFAULT false NOT NULL;