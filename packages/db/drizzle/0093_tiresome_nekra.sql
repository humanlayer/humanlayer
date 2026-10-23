DO $$ BEGIN
	CREATE TYPE "public"."online_host_status" AS ENUM('online', 'offline');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "online_hosts" ADD COLUMN IF NOT EXISTS "status" "online_host_status" DEFAULT 'online' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "online_hosts_status_last_seen_idx" ON "online_hosts" USING btree ("status","last_seen");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_org_creator_host_idx" ON "sessions" USING btree ("organization_id","created_by","host_id");
