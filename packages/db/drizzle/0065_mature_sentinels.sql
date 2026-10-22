CREATE TYPE "public"."access_request_notification_status" AS ENUM('not_started', 'scheduled', 'partial', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'invited', 'archived');--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"artifact_id" uuid,
	"artifact_title_snapshot" text NOT NULL,
	"artifact_owner_user_id" text NOT NULL,
	"requester_user_id" text,
	"requester_email" text NOT NULL,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"request_generation" integer DEFAULT 1 NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reminder_scheduled_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"notification_status" "access_request_notification_status" DEFAULT 'not_started' NOT NULL,
	"initial_email_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_reminders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "access_requests_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_artifact_email_idx" ON "access_requests" USING btree ("artifact_id","requester_email");--> statement-breakpoint
CREATE INDEX "access_requests_org_idx" ON "access_requests" USING btree ("organization_id");