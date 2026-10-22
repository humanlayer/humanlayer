ALTER TABLE "online_hosts" DROP CONSTRAINT "online_hosts_one_daemon_per_host_per_organization_per_user_";--> statement-breakpoint
DROP INDEX "online_hosts_organization_id_user_id_index";--> statement-breakpoint
DROP INDEX "sessions_organization_created_by_host_id_index";--> statement-breakpoint
DROP INDEX "tasks_organization_id_index";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "created_by" text;--> statement-breakpoint
CREATE INDEX "online_hosts_host_id_organization_id_user_id_index" ON "online_hosts" USING btree ("host_id","organization_id","user_id");--> statement-breakpoint
CREATE INDEX "sessions_organization_created_by_host_index" ON "sessions" USING btree ("organization_id","created_by","host_id");--> statement-breakpoint
CREATE INDEX "tasks_organization_id_created_by_index" ON "tasks" USING btree ("organization_id","created_by");--> statement-breakpoint
ALTER TABLE "online_hosts" ADD CONSTRAINT "online_hosts_unique" UNIQUE("host_id","organization_id","user_id");