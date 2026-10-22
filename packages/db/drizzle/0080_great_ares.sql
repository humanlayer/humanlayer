CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid,
	"session_id" uuid,
	"resource_owner_user_id" text,
	"author_github_login" text,
	"author_github_id" text,
	"author_is_bot" boolean DEFAULT false NOT NULL,
	"repo_full_name" text NOT NULL,
	"number" integer NOT NULL,
	"github_node_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"head_ref" text NOT NULL,
	"base_ref" text,
	"opened_at" bigint,
	"merged_at" bigint,
	"merged_by_github_login" text,
	"closed_at" bigint,
	"source" text DEFAULT 'daemon' NOT NULL,
	"capture_version" integer DEFAULT 1 NOT NULL,
	"captured_host_id" text,
	"last_checked_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_login" text NOT NULL,
	"email" text,
	"source" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_org_repo_number_idx" ON "pull_requests" USING btree ("organization_id","repo_full_name","number");--> statement-breakpoint
CREATE INDEX "pull_requests_org_owner_merged_idx" ON "pull_requests" USING btree ("organization_id","resource_owner_user_id","merged_at");--> statement-breakpoint
CREATE INDEX "pull_requests_org_task_session_idx" ON "pull_requests" USING btree ("organization_id","task_id","session_id");--> statement-breakpoint
CREATE INDEX "pull_requests_session_id_idx" ON "pull_requests" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "pull_requests_org_host_state_idx" ON "pull_requests" USING btree ("organization_id","captured_host_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_org_provider_user_idx" ON "user_identities" USING btree ("organization_id","provider","user_id");--> statement-breakpoint
CREATE INDEX "user_identities_org_provider_login_idx" ON "user_identities" USING btree ("organization_id","provider","external_login");