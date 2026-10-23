CREATE TABLE "pull_request_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"number" integer NOT NULL,
	"session_id" uuid NOT NULL,
	"task_id" uuid,
	"user_id" text,
	"tier" text NOT NULL,
	"linked_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
DROP INDEX "pull_requests_org_host_state_idx";--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "attribution_method" text;--> statement-breakpoint
ALTER TABLE "pull_request_sessions" ADD CONSTRAINT "pull_request_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_sessions" ADD CONSTRAINT "pull_request_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_sessions" ADD CONSTRAINT "pull_request_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_sessions_org_repo_number_session_idx" ON "pull_request_sessions" USING btree ("organization_id","repo_full_name","number","session_id");--> statement-breakpoint
CREATE INDEX "pull_request_sessions_org_task_session_idx" ON "pull_request_sessions" USING btree ("organization_id","task_id","session_id");--> statement-breakpoint
CREATE INDEX "pull_request_sessions_session_id_idx" ON "pull_request_sessions" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "pull_requests" DROP COLUMN "captured_host_id";--> statement-breakpoint
UPDATE "pull_requests" pr SET "attribution_method" = 'committed'
WHERE pr."attribution_method" IS NULL AND pr."session_id" IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM "commits" c
		WHERE c."organization_id" = pr."organization_id"
			AND c."session_id" = pr."session_id"
			AND c."repo_full_name" = pr."repo_full_name"
			AND c."branch" = pr."head_ref"
	);--> statement-breakpoint
UPDATE "pull_requests" SET "attribution_method" = 'observed'
WHERE "attribution_method" IS NULL AND "session_id" IS NOT NULL;
