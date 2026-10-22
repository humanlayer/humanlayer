CREATE TABLE "queued_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid,
	"organization_id" uuid NOT NULL,
	"resource_owner_user_id" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queued_messages_session_status_created_at_idx" ON "queued_messages" USING btree ("session_id","status","created_at");--> statement-breakpoint
CREATE INDEX "queued_messages_org_owner_session_idx" ON "queued_messages" USING btree ("organization_id","resource_owner_user_id","session_id");--> statement-breakpoint
CREATE INDEX "queued_messages_org_task_session_idx" ON "queued_messages" USING btree ("organization_id","task_id","session_id");