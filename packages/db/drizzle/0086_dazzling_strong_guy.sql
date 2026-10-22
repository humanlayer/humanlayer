CREATE TABLE "task_workspace_setup_for_host" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"host_id" text NOT NULL,
	"status" text DEFAULT 'setup_requested' NOT NULL,
	"workspace_setup_state" jsonb NOT NULL,
	"error" jsonb,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "task_workspace_setup_for_host_unique" UNIQUE("organization_id","task_id","host_id"),
	CONSTRAINT "task_workspace_setup_for_host_status_check" CHECK ("task_workspace_setup_for_host"."status" in ('setup_requested', 'preflight', 'worktree', 'copy_globs', 'setup_command', 'done'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "workspace_spec" jsonb;--> statement-breakpoint
ALTER TABLE "task_workspace_setup_for_host" ADD CONSTRAINT "task_workspace_setup_for_host_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workspace_setup_for_host" ADD CONSTRAINT "task_workspace_setup_for_host_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "task_workspace_setup_for_host" ADD CONSTRAINT "task_workspace_setup_for_host_org_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_workspace_setup_for_host_org_host_idx" ON "task_workspace_setup_for_host" USING btree ("organization_id","host_id");
