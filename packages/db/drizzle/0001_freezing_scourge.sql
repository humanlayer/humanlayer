ALTER TABLE "online_hosts" RENAME COLUMN "host_key" TO "host_id";--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "host" TO "host_id";--> statement-breakpoint
DROP INDEX "sessions_organization_created_by_host_index";--> statement-breakpoint
CREATE INDEX "sessions_organization_created_by_host_id_index" ON "sessions" USING btree ("organization_id","created_by","host_id");