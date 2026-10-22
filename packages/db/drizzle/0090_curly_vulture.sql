CREATE TABLE "jira_integration_install_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"state_token_hash" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"return_client" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "jira_integration_install_states_state_token_hash_unique" UNIQUE("state_token_hash")
);
--> statement-breakpoint
ALTER TABLE "jira_integration_install_states" ADD CONSTRAINT "jira_integration_install_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jira_install_states_organization_id_index" ON "jira_integration_install_states" USING btree ("organization_id");