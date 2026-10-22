DROP INDEX "commits_org_task_idx";--> statement-breakpoint
CREATE INDEX "commits_org_task_session_idx" ON "commits" USING btree ("organization_id","task_id","session_id");