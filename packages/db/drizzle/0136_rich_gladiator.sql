ALTER TABLE "user_settings" ADD COLUMN "projects_v2_assigned_variant" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "projects_v2_assigned_at" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_projects_v2_assigned_variant_check" CHECK ("user_settings"."projects_v2_assigned_variant" IN ('v1', 'v2'));