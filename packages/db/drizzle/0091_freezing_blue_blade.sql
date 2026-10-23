CREATE TABLE "staged_uploads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"content_hash" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"s3_key" text NOT NULL,
	"state" text DEFAULT 'uploading' NOT NULL,
	"expires_at" bigint NOT NULL,
	"claimed_task_id" uuid,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "staged_uploads_state_check" CHECK ("staged_uploads"."state" IN ('uploading', 'ready', 'claimed')),
	CONSTRAINT "staged_uploads_content_hash_check" CHECK ("staged_uploads"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "staged_uploads_file_size_bytes_check" CHECK ("staged_uploads"."file_size_bytes" >= 0 AND "staged_uploads"."file_size_bytes" <= 52428800),
	CONSTRAINT "staged_uploads_expires_at_check" CHECK ("staged_uploads"."expires_at" > 0)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_with_experiment_flags" jsonb;--> statement-breakpoint
ALTER TABLE "staged_uploads" ADD CONSTRAINT "staged_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staged_uploads" ADD CONSTRAINT "staged_uploads_claimed_task_id_tasks_id_fk" FOREIGN KEY ("claimed_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staged_uploads_org_user_idx" ON "staged_uploads" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "staged_uploads_claimed_task_id_idx" ON "staged_uploads" USING btree ("claimed_task_id");