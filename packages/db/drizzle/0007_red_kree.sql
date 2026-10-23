ALTER TABLE "conversation_events" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "context_window_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "context_window_limit" integer DEFAULT 168000;