CREATE TABLE "project_locations_for_user_for_host" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"host_id" text NOT NULL,
	"repository_paths" jsonb NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "project_locations_for_user_for_host_organization_id_project_id_user_id_host_id_pk" PRIMARY KEY("organization_id","project_id","user_id","host_id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "source_mode" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "resource_owner_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "repositories" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "projects_v2_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "projects_organization_id_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "project_locations_for_user_for_host" ADD CONSTRAINT "project_locations_for_user_for_host_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_locations_for_user_for_host" ADD CONSTRAINT "project_locations_for_user_for_host_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_locations_for_user_for_host" ADD CONSTRAINT "project_locations_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "projects_source_mode_check" CHECK ("project"."source_mode" in ('filesystem', 'managed_clone'));
