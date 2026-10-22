CREATE TABLE "acl_operations_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"acl_type" text NOT NULL,
	"acl_entry_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_user_id" text,
	"target_organization_id" uuid,
	"operation" text NOT NULL,
	"performed_by" text NOT NULL,
	"permission_level_before" text,
	"permission_level_after" text,
	"resource_owner_user_id" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_operations_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"session_id" uuid,
	"task_id" uuid,
	"task_slug" text,
	"resource_owner_user_id" text NOT NULL,
	"created_by" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"operation_contents" jsonb NOT NULL,
	"version_created" boolean DEFAULT false,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"task_id" uuid,
	"task_slug" text,
	"resource_owner_user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"version_number" integer NOT NULL,
	CONSTRAINT "artifact_versions_artifact_version_unique" UNIQUE("artifact_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid,
	"task_slug" text,
	"resource_owner_user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "artifacts_task_file_unique" UNIQUE("task_id","file_name")
);
--> statement-breakpoint
CREATE TABLE "task_organization_acl" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_owner_user_id" text NOT NULL,
	"permission_level" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "task_organization_acl_unique" UNIQUE("organization_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "task_user_acl" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"subject_user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_owner_user_id" text NOT NULL,
	"permission_level" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "task_user_acl_unique" UNIQUE("organization_id","subject_user_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "resource_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD COLUMN "resource_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "resource_owner_user_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "resource_owner_user_id" text;--> statement-breakpoint

-- Backfill resource_owner_user_id and task_id from existing data
-- Sessions: backfill from created_by (which is NOT NULL)
UPDATE "sessions" SET resource_owner_user_id = created_by WHERE resource_owner_user_id IS NULL;--> statement-breakpoint

-- Tasks: backfill from created_by (which is NULLABLE, so only update non-null rows)
UPDATE "tasks" SET resource_owner_user_id = created_by WHERE resource_owner_user_id IS NULL AND created_by IS NOT NULL;--> statement-breakpoint

-- conversation_events: backfill resource_owner_user_id and task_id via join to parent session
UPDATE "conversation_events" ce SET
  resource_owner_user_id = s.resource_owner_user_id,
  task_id = s.task_id
FROM "sessions" s WHERE ce.session_id = s.id AND ce.resource_owner_user_id IS NULL;--> statement-breakpoint

-- approvals: backfill resource_owner_user_id and task_id via join to parent session
UPDATE "approvals" a SET
  resource_owner_user_id = s.resource_owner_user_id,
  task_id = s.task_id
FROM "sessions" s WHERE a.session_id = s.id AND a.resource_owner_user_id IS NULL;--> statement-breakpoint

ALTER TABLE "artifact_operations_log" ADD CONSTRAINT "artifact_operations_log_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_operations_log" ADD CONSTRAINT "artifact_operations_log_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_operations_log" ADD CONSTRAINT "artifact_operations_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_organization_acl" ADD CONSTRAINT "task_organization_acl_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_organization_acl" ADD CONSTRAINT "task_organization_acl_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_user_acl" ADD CONSTRAINT "task_user_acl_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_user_acl" ADD CONSTRAINT "task_user_acl_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acl_operations_log_task_id_idx" ON "acl_operations_log" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "acl_operations_log_performed_by_idx" ON "acl_operations_log" USING btree ("performed_by");--> statement-breakpoint
CREATE INDEX "artifact_operations_log_artifact_id_idx" ON "artifact_operations_log" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifacts_org_owner_idx" ON "artifacts" USING btree ("organization_id","resource_owner_user_id");--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;