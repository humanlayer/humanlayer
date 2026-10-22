ALTER TABLE "sessions" DROP CONSTRAINT "sessions_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;