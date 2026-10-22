ALTER TABLE "user_settings" ADD COLUMN "onboarding_dismissed_at" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "first_task_completed_at" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "first_structured_workflow_completed_at" bigint;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "first_inbound_comment_received_at" bigint;