CREATE TABLE "session_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_owner_user_id" text NOT NULL,
	"task_id" uuid,
	"coding_agent" text NOT NULL,
	"source" text NOT NULL,
	"report_key" text NOT NULL,
	"model" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision,
	"occurred_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "session_usage_events_report_model_unique" UNIQUE("session_id","report_key","model")
);
--> statement-breakpoint
ALTER TABLE "session_usage_events" ADD CONSTRAINT "session_usage_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_usage_events" ADD CONSTRAINT "session_usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_usage_events" ADD CONSTRAINT "session_usage_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_usage_events_org_occurred_idx" ON "session_usage_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "session_usage_events_org_owner_occurred_idx" ON "session_usage_events" USING btree ("organization_id","resource_owner_user_id","occurred_at");