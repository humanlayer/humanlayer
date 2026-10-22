CREATE TABLE "slack_notification_automations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text,
	"channel_is_private" boolean DEFAULT false NOT NULL,
	"event_types" text[] NOT NULL,
	"owner_user_ids" text[],
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_notification_automations" ADD CONSTRAINT "slack_notification_automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slack_notification_automations_org_enabled_idx" ON "slack_notification_automations" USING btree ("organization_id","enabled");