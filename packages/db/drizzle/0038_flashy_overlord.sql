CREATE TABLE "jira_integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cloud_id" text NOT NULL,
	"site_url" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" bigint NOT NULL,
	"scopes" text NOT NULL,
	"connected_by" text NOT NULL,
	"needs_reauth" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "jira_integrations_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "jira_integration_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ticket_provider" text;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD CONSTRAINT "jira_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jira_integrations_organization_id_index" ON "jira_integrations" USING btree ("organization_id");