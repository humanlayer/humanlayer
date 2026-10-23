CREATE TABLE "artifact_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resource_owner_user_id" text NOT NULL,
	"task_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"reply_to_comment_id" uuid,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"content_text" text NOT NULL,
	"content_json" jsonb,
	"artifact_id" uuid NOT NULL,
	"created_at_artifact_version_id" uuid,
	"highlighted_text" text,
	"highlighted_text_line_number" integer,
	"highlighted_text_has_match_in_current_artifact" boolean,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_by_user_id" text,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_created_at_artifact_version_id_artifact_versions_id_fk" FOREIGN KEY ("created_at_artifact_version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_comments_org_owner_idx" ON "artifact_comments" USING btree ("organization_id","resource_owner_user_id");--> statement-breakpoint
CREATE INDEX "artifact_comments_org_task_idx" ON "artifact_comments" USING btree ("organization_id","task_id");--> statement-breakpoint
CREATE INDEX "artifact_comments_artifact_id_idx" ON "artifact_comments" USING btree ("artifact_id");