CREATE TABLE "commit_watch_watermarks" (
	"host_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"repo_directory" text NOT NULL,
	"last_seen_sha" text,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "commit_watch_watermarks_unique" UNIQUE("host_id","organization_id","repo_directory")
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid,
	"task_id" uuid,
	"resource_owner_user_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"parent_shas" jsonb,
	"branch" text,
	"repo_remote_url" text,
	"repo_full_name" text,
	"repo_directory" text,
	"subject" text NOT NULL,
	"body" text,
	"author_name" text,
	"author_email" text,
	"authored_at" bigint,
	"committed_at" bigint NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"files_changed" integer DEFAULT 0 NOT NULL,
	"file_stats" jsonb,
	"co_authored_by_agent" boolean DEFAULT false NOT NULL,
	"coding_agent" text,
	"capture_algorithm_version" integer NOT NULL,
	"attribution_method" text,
	"ai_confidence" double precision,
	"ai_attributed_lines" integer,
	"attribution_algorithm_version" integer,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commit_watch_watermarks" ADD CONSTRAINT "commit_watch_watermarks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commit_watch_watermarks_org_host_idx" ON "commit_watch_watermarks" USING btree ("organization_id","host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commits_org_sha_idx" ON "commits" USING btree ("organization_id","commit_sha");--> statement-breakpoint
CREATE INDEX "commits_org_owner_committed_idx" ON "commits" USING btree ("organization_id","resource_owner_user_id","committed_at");--> statement-breakpoint
CREATE INDEX "commits_org_task_idx" ON "commits" USING btree ("organization_id","task_id");--> statement-breakpoint
CREATE INDEX "commits_session_id_idx" ON "commits" USING btree ("session_id");