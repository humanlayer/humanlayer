CREATE TABLE "slack_integration_install_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"state_token_hash" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "slack_integration_install_states_state_token_hash_unique" UNIQUE("state_token_hash")
);
--> statement-breakpoint
CREATE TABLE "slack_integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bot_access_token" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"scopes" text NOT NULL,
	"slack_team_id" text,
	"slack_team_name" text,
	"app_id" text,
	"connected_by_user_id" text NOT NULL,
	"needs_reauth" boolean DEFAULT false NOT NULL,
	"last_error_code" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "slack_integrations_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "slack_integration_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_integration_install_states" ADD CONSTRAINT "slack_integration_install_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;