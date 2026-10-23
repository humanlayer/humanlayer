CREATE TABLE "diff_comments" (
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
	"anchor_json" jsonb,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_by_user_id" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by_agent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diff_comments" ADD CONSTRAINT "diff_comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diff_comments" ADD CONSTRAINT "diff_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diff_comments_org_task_idx" ON "diff_comments" USING btree ("organization_id","task_id");