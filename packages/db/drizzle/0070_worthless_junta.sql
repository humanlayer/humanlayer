CREATE TABLE "slack_notification_threads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"automation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"root_thread_ts" text,
	"root_message_ts" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error_code" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "slack_notification_threads_automation_channel_task_unique" UNIQUE("automation_id","channel_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "slack_notification_threads" ADD CONSTRAINT "slack_notification_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_notification_threads" ADD CONSTRAINT "slack_notification_threads_automation_id_slack_notification_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."slack_notification_automations"("id") ON DELETE cascade ON UPDATE no action;