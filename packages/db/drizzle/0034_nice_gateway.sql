CREATE TABLE "task_user_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"working_directory" text,
	"host_id" text,
	"auto_advance_questions_to_research" boolean,
	"auto_advance_research_to_design" boolean,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "task_user_settings_unique" UNIQUE("organization_id","user_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "task_user_settings" ADD CONSTRAINT "task_user_settings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_user_settings" ADD CONSTRAINT "task_user_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;