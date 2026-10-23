CREATE TABLE "host_aliases" (
	"host_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	CONSTRAINT "host_aliases_unique" UNIQUE("host_id","user_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "host_aliases" ADD CONSTRAINT "host_aliases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;