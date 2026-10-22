ALTER TABLE "approvals" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
DROP INDEX "approvals_session_id_idex";--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "session_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "host_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "agent_id" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "suggestions" jsonb;--> statement-breakpoint
CREATE INDEX "approvals_org_user_host_session_status_idx" ON "approvals" USING btree ("organization_id","user_id","host_id","session_id","status");