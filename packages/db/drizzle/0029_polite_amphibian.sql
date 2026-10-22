DROP INDEX "online_hosts_host_id_organization_id_user_id_index";--> statement-breakpoint
CREATE INDEX "online_hosts_org_user_idx" ON "online_hosts" USING btree ("organization_id","user_id");