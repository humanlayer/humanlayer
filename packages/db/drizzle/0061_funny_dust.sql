ALTER TABLE "sessions" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "fast_mode" boolean DEFAULT false NOT NULL;