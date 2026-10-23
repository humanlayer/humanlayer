CREATE TYPE "public"."github_account_type" AS ENUM('Organization', 'User');--> statement-breakpoint
CREATE TYPE "public"."github_installation_status" AS ENUM('active', 'unclaimed', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."github_repository_selection" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TABLE "github_integration_install_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"state_token_hash" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"repair_connection_id" uuid,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "github_integration_install_states_state_token_hash_unique" UNIQUE("state_token_hash")
);
--> statement-breakpoint
CREATE TABLE "github_integration_repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"integration_id" uuid NOT NULL,
	"github_repository_id" text NOT NULL,
	"owner_login" text NOT NULL,
	"repository_name" text NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean NOT NULL,
	"default_branch" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"installation_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" "github_account_type" NOT NULL,
	"access_token" text,
	"token_expires_at" bigint,
	"token_generation" bigint DEFAULT 0 NOT NULL,
	"repository_selection" "github_repository_selection" NOT NULL,
	"permissions" jsonb NOT NULL,
	"installation_status" "github_installation_status" NOT NULL,
	"suspended_at" bigint,
	"suspended_by_id" text,
	"suspended_by_login" text,
	"needs_reauth" boolean DEFAULT false NOT NULL,
	"connected_by_user_id" text,
	"last_reconciled_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "github_integrations_claim_fields_check" CHECK (("github_integrations"."installation_status" = 'unclaimed' AND "github_integrations"."organization_id" IS NULL AND "github_integrations"."connected_by_user_id" IS NULL) OR ("github_integrations"."installation_status" = 'active' AND "github_integrations"."organization_id" IS NOT NULL AND "github_integrations"."connected_by_user_id" IS NOT NULL) OR ("github_integrations"."installation_status" = 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "github_integration_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "github_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ticket_repository_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "ticket_repository_full_name" text;--> statement-breakpoint
ALTER TABLE "github_integration_install_states" ADD CONSTRAINT "github_integration_install_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integration_install_states" ADD CONSTRAINT "github_integration_install_states_repair_connection_id_github_integrations_id_fk" FOREIGN KEY ("repair_connection_id") REFERENCES "public"."github_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integration_repositories" ADD CONSTRAINT "github_integration_repositories_integration_id_github_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."github_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_install_states_organization_id_index" ON "github_integration_install_states" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_repositories_integration_repository_unique" ON "github_integration_repositories" USING btree ("integration_id","github_repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_repositories_integration_full_name_unique" ON "github_integration_repositories" USING btree ("integration_id","full_name");--> statement-breakpoint
CREATE INDEX "github_integrations_organization_id_index" ON "github_integrations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_integrations_installation_id_unique" ON "github_integrations" USING btree ("installation_id");