DROP INDEX "approvals_org_user_host_session_status_idx";--> statement-breakpoint
CREATE INDEX "approvals_org_owner_idx" ON "approvals" USING btree ("organization_id","resource_owner_user_id");--> statement-breakpoint
CREATE INDEX "approvals_org_task_idx" ON "approvals" USING btree ("organization_id","task_id");