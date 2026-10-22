CREATE TYPE "public"."online_host_distribution" AS ENUM('cli', 'desktop');--> statement-breakpoint
CREATE TYPE "public"."online_host_update_state" AS ENUM('requested', 'installing', 'failed');--> statement-breakpoint
ALTER TABLE "online_hosts" ADD COLUMN "distribution" "online_host_distribution";--> statement-breakpoint
ALTER TABLE "online_hosts" ADD COLUMN "can_self_update" boolean;--> statement-breakpoint
ALTER TABLE "online_hosts" ADD COLUMN "update_requested_version" text;--> statement-breakpoint
ALTER TABLE "online_hosts" ADD COLUMN "update_state" "online_host_update_state";--> statement-breakpoint
ALTER TABLE "online_hosts" ADD COLUMN "update_error" text;