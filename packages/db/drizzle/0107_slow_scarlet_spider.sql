CREATE TABLE "task_launches" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"first_session_id" uuid NOT NULL,
	"launch_transaction_id" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "task_launches_first_session_id_unique" UNIQUE("first_session_id")
);
--> statement-breakpoint
ALTER TABLE "task_launches" ADD CONSTRAINT "task_launches_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_launches" ADD CONSTRAINT "task_launches_first_session_id_sessions_id_fk" FOREIGN KEY ("first_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;