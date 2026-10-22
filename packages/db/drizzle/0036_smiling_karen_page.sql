ALTER TABLE "task_user_settings" ALTER COLUMN "auto_advance_questions_to_research" SET DEFAULT false;--> statement-breakpoint
UPDATE "task_user_settings" SET "auto_advance_questions_to_research" = false WHERE "auto_advance_questions_to_research" IS NULL;--> statement-breakpoint
ALTER TABLE "task_user_settings" ALTER COLUMN "auto_advance_questions_to_research" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_user_settings" ALTER COLUMN "auto_advance_research_to_design" SET DEFAULT false;--> statement-breakpoint
UPDATE "task_user_settings" SET "auto_advance_research_to_design" = false WHERE "auto_advance_research_to_design" IS NULL;--> statement-breakpoint
ALTER TABLE "task_user_settings" ALTER COLUMN "auto_advance_research_to_design" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_user_settings" ADD COLUMN "auto_advance_plan_to_worktree" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_user_settings" ADD COLUMN "auto_advance_worktree_to_implementation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_user_settings" ADD COLUMN "auto_advance_implementation_to_pr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "auto_advance_plan_to_worktree" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "auto_advance_worktree_to_implementation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "auto_advance_implementation_to_pr" boolean DEFAULT false NOT NULL;