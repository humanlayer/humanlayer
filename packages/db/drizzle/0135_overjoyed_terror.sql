DROP INDEX "session_usage_events_org_owner_occurred_idx";--> statement-breakpoint
ALTER TABLE "session_usage_events" ADD COLUMN "session_creator_user_id" text;--> statement-breakpoint
-- Every usage row has a session (FK ON DELETE cascade) and sessions.created_by is written once and
-- never updated, so this reconstructs exactly what the write path would have stamped at ingest.
UPDATE "session_usage_events" u SET "session_creator_user_id" = s."created_by" FROM "sessions" s WHERE s."id" = u."session_id";--> statement-breakpoint
ALTER TABLE "session_usage_events" ALTER COLUMN "session_creator_user_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "session_usage_events_org_creator_occurred_idx" ON "session_usage_events" USING btree ("organization_id","session_creator_user_id","occurred_at");
