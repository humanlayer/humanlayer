CREATE TABLE "agent_slash_commands" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"host_id" text NOT NULL,
	"agent" text DEFAULT 'claude' NOT NULL,
	"workspace_path" text NOT NULL,
	"commands" jsonb NOT NULL,
	"skills" jsonb NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "agent_slash_commands_pk" PRIMARY KEY("organization_id","user_id","host_id","agent","workspace_path")
);
--> statement-breakpoint
ALTER TABLE "agent_slash_commands" ADD CONSTRAINT "agent_slash_commands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;