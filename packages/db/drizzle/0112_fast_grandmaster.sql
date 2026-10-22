CREATE TABLE "workspace_locations_for_user_for_host" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"host_id" text NOT NULL,
	"file_path" text NOT NULL,
	"setup_generation" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "workspace_locations_for_user_for_host_pk" PRIMARY KEY("organization_id","project_id","workspace_id","user_id","host_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_locations_for_user_for_host" ADD CONSTRAINT "workspace_locations_for_user_for_host_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_locations_for_user_for_host" ADD CONSTRAINT "workspace_locations_for_user_for_host_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_locations_for_user_for_host" ADD CONSTRAINT "workspace_locations_for_user_for_host_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;