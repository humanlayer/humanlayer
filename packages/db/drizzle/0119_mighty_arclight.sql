ALTER TABLE "pull_requests" ADD COLUMN "unresolved_thread_count" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "resolved_thread_count" integer;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "changes_requested_reviews" jsonb;