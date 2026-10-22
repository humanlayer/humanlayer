DROP INDEX "online_hosts_organization_id_user_id_index";--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'online_hosts'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "online_hosts" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
CREATE INDEX "online_hosts_organization_id_user_id_index" ON "online_hosts" USING btree ("host_id","organization_id","user_id");--> statement-breakpoint
ALTER TABLE "online_hosts" ADD CONSTRAINT "online_hosts_one_daemon_per_host_per_organization_per_user_" UNIQUE("host_id","organization_id","user_id");