CREATE TABLE "codelayer_agent_state_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_owner_user_id" text NOT NULL,
	"task_id" uuid,
	"run_index" integer NOT NULL,
	"root_user_event_id" uuid,
	"copied_from_snapshot_id" uuid,
	"state" jsonb,
	"tombstoned_at" bigint,
	"tombstone_reason" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_events" ADD COLUMN "run_index" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "fork_data" jsonb;--> statement-breakpoint
ALTER TABLE "codelayer_agent_state_snapshots" ADD CONSTRAINT "codelayer_agent_state_snapshots_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codelayer_agent_state_snapshots" ADD CONSTRAINT "codelayer_agent_state_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codelayer_agent_state_snapshots" ADD CONSTRAINT "codelayer_agent_state_snapshots_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codelayer_agent_state_snapshots" ADD CONSTRAINT "codelayer_agent_state_snapshots_root_user_event_id_conversation_events_id_fk" FOREIGN KEY ("root_user_event_id") REFERENCES "public"."conversation_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codelayer_agent_state_snapshots_org_owner_session_idx" ON "codelayer_agent_state_snapshots" USING btree ("organization_id","resource_owner_user_id","session_id");--> statement-breakpoint
CREATE INDEX "codelayer_agent_state_snapshots_session_run_idx" ON "codelayer_agent_state_snapshots" USING btree ("session_id","run_index");--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "editor_state";