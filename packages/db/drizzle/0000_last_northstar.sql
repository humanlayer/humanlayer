CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid,
	"tool_use_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"responded_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"tool_name" text,
	"tool_input" jsonb,
	"comment" text,
	"userId" text
);
--> statement-breakpoint
CREATE TABLE "conversation_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"coding_agent_event_id" text,
	"session_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"coding_agent_session_id" text,
	"event_type" text NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_call_id" text,
	"tool_name" text,
	"tool_input_json" jsonb,
	"parent_tool_use_id" text,
	"tool_result_for_id" text,
	"tool_result_content" text,
	"approval_status" text,
	"approval_id" uuid,
	"user_id" text,
	"user_name" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "online_hosts" (
	"host_key" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"host_name" text,
	"last_seen" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"organization_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"name" text NOT NULL,
	"workos_organization_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid,
	"organization_id" uuid NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid,
	"organization_id" uuid,
	"created_by" text NOT NULL,
	"coding_agent" text DEFAULT 'claude' NOT NULL,
	"coding_agent_session_id" text,
	"host" text NOT NULL,
	"working_directory" text NOT NULL,
	"model" text,
	"provider" text,
	"title" text,
	"summary" text,
	"status" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_activity_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"num_events" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"permissions_mode" text DEFAULT 'default' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"editor_state" jsonb,
	"workflow_type" text,
	"prompt" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid,
	"project_id" uuid,
	"organization_id" uuid NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"name" text NOT NULL,
	"external_task_id" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_hosts" ADD CONSTRAINT "online_hosts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_session_id_idex" ON "approvals" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "conversation_events_session_id_organization_id_index" ON "conversation_events" USING btree ("session_id","organization_id");--> statement-breakpoint
CREATE INDEX "online_hosts_organization_id_user_id_index" ON "online_hosts" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organizations_workos_organization_id_index" ON "organizations" USING btree ("workos_organization_id");--> statement-breakpoint
CREATE INDEX "projects_organization_id_index" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sessions_organization_created_by_host_index" ON "sessions" USING btree ("organization_id","created_by","host");--> statement-breakpoint
CREATE INDEX "tasks_organization_id_index" ON "tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teams_organization_id_index" ON "teams" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "user_settings_user_id_index" ON "user_settings" USING btree ("user_id");