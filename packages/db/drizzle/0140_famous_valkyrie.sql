CREATE TABLE "agent_command_discovery_requests" (
	"organization_id" uuid NOT NULL,
	"host_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent" text DEFAULT 'claude' NOT NULL,
	"workspace_path" text NOT NULL,
	"requested_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "agent_command_discovery_requests_pk" PRIMARY KEY("organization_id","host_id","user_id","agent")
);
--> statement-breakpoint
ALTER TABLE "agent_command_discovery_requests" ADD CONSTRAINT "agent_command_discovery_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;