DROP INDEX "sessions_organization_created_by_host_index";--> statement-breakpoint
CREATE INDEX "sessions_org_owner_host_idx" ON "sessions" USING btree ("organization_id","resource_owner_user_id","host_id");--> statement-breakpoint
CREATE INDEX "sessions_org_task_idx" ON "sessions" USING btree ("organization_id","task_id");