CREATE TABLE "session_repositories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid,
	"host_id" text NOT NULL,
	"local_path" text NOT NULL,
	"remote_url" text,
	"repo_full_name" text,
	"branch" text,
	"is_head" boolean DEFAULT true NOT NULL,
	"first_seen_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_seen_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "session_repositories_session_path_branch_key" UNIQUE NULLS NOT DISTINCT("organization_id","session_id","local_path","branch")
);
--> statement-breakpoint
ALTER TABLE "session_repositories" ADD CONSTRAINT "session_repositories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_repositories" ADD CONSTRAINT "session_repositories_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_repositories" ADD CONSTRAINT "session_repositories_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_repositories_org_repo_branch_idx" ON "session_repositories" USING btree ("organization_id","repo_full_name","branch");--> statement-breakpoint
CREATE INDEX "session_repositories_org_task_idx" ON "session_repositories" USING btree ("organization_id","task_id");--> statement-breakpoint
CREATE INDEX "session_repositories_session_id_idx" ON "session_repositories" USING btree ("session_id");