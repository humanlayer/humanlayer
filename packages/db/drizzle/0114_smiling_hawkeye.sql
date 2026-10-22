ALTER TABLE "tasks" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_org_project_workspace_idx" ON "tasks" USING btree ("organization_id","project_id","workspace_id");