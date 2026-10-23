ALTER TABLE "organization_settings" DROP CONSTRAINT "organization_settings_sync_visibility_check";--> statement-breakpoint
ALTER TABLE "organization_settings" DROP COLUMN "sync_version";--> statement-breakpoint
ALTER TABLE "organization_settings" DROP COLUMN "sync_visibility";