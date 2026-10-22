CREATE TABLE "workspace_repository_status_for_user_for_host" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"host_id" text NOT NULL,
	"repository_identity" text NOT NULL,
	"repository_remote_url" text NOT NULL,
	"status" text DEFAULT 'setup_requested' NOT NULL,
	"repo_available" boolean DEFAULT false NOT NULL,
	"source_kind" text,
	"source_path" text,
	"resolved_commit" text,
	"materialization" jsonb,
	"branch_publish_status" text,
	"copy_result" jsonb,
	"setup_command_result" jsonb,
	"error" jsonb,
	"generation" bigint DEFAULT 1 NOT NULL,
	"current_branch" text,
	"local_head" text,
	"remote_head" text,
	"ahead_count" integer,
	"behind_count" integer,
	"dirty" boolean,
	"git_state_checked_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "workspace_repository_status_for_user_for_host_pk" PRIMARY KEY("organization_id","project_id","workspace_id","user_id","host_id","repository_identity")
);
--> statement-breakpoint
ALTER TABLE "workspace_repository_status_for_user_for_host" ADD CONSTRAINT "workspace_repository_status_for_user_for_host_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_repository_status_for_user_for_host" ADD CONSTRAINT "workspace_repository_status_for_user_for_host_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_repository_status_for_user_for_host" ADD CONSTRAINT "workspace_repository_status_for_user_for_host_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_repository_status_org_user_host_idx" ON "workspace_repository_status_for_user_for_host" USING btree ("organization_id","user_id","host_id","status");