ALTER TABLE "organization_settings" DROP CONSTRAINT "organization_settings_v1_backend_check";--> statement-breakpoint
ALTER TABLE "organization_settings" DROP CONSTRAINT "organization_settings_sync_visibility_v1_backend_consistency_check";--> statement-breakpoint
ALTER TABLE "organization_settings" DROP COLUMN "v1_backend";