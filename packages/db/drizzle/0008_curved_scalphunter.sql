ALTER TABLE "sessions" ADD COLUMN "total_cost_usd" real;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "model_usage" jsonb;