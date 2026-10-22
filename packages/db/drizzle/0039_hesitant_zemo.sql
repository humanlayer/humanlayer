CREATE TABLE "linear_integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" bigint NOT NULL,
	"scopes" text NOT NULL,
	"connected_by" text NOT NULL,
	"needs_reauth" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "linear_integrations_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "linear_integration_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "linear_integrations" ADD CONSTRAINT "linear_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linear_integrations_organization_id_index" ON "linear_integrations" USING btree ("organization_id");