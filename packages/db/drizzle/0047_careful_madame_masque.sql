CREATE TABLE "codelayer_agent_state" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_owner_user_id" text NOT NULL,
	"task_id" uuid,
	"state" jsonb NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "codelayer_agent_state_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "default_agent" text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE "codelayer_agent_state" ADD CONSTRAINT "codelayer_agent_state_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codelayer_agent_state" ADD CONSTRAINT "codelayer_agent_state_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codelayer_agent_state" ADD CONSTRAINT "codelayer_agent_state_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;