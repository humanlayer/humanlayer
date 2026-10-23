ALTER TABLE "pull_requests" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "mergeable" boolean;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "review_decision" text;