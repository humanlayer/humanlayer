CREATE TABLE "repository_locations_for_user_for_host" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"host_id" text NOT NULL,
	"repository_identity" text NOT NULL,
	"source_path" text NOT NULL,
	"source_kind" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "repository_locations_for_user_for_host_pk" PRIMARY KEY("organization_id","user_id","host_id","repository_identity"),
	CONSTRAINT "repository_locations_source_kind_check" CHECK ("repository_locations_for_user_for_host"."source_kind" in ('filesystem', 'managed_clone')),
	CONSTRAINT "repository_locations_source_path_check" CHECK (length("repository_locations_for_user_for_host"."source_path") > 0)
);
--> statement-breakpoint
ALTER TABLE "project_locations_for_user_for_host" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "project_locations_for_user_for_host" CASCADE;--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "projects_source_mode_check";--> statement-breakpoint
ALTER TABLE "repository_locations_for_user_for_host" ADD CONSTRAINT "repository_locations_for_user_for_host_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "source_mode";