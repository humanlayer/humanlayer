ALTER TABLE "artifacts" ADD COLUMN "storage_type" text DEFAULT 'postgres' NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "s3_key" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "file_size_bytes" bigint;