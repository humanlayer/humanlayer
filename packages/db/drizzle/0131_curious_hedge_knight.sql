CREATE TABLE "provider_login_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"host_id" text NOT NULL,
	"provider" text NOT NULL,
	"method" text DEFAULT 'device' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"url" text,
	"user_code" text,
	"submitted_code" text,
	"error" text,
	"account_label" text,
	"expires_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "provider_login_requests_provider_check" CHECK ("provider_login_requests"."provider" in ('claude', 'codex', 'xai')),
	CONSTRAINT "provider_login_requests_method_check" CHECK ("provider_login_requests"."method" in ('browser', 'device')),
	CONSTRAINT "provider_login_requests_status_check" CHECK ("provider_login_requests"."status" in ('requested', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "error_reason" text;--> statement-breakpoint
ALTER TABLE "provider_login_requests" ADD CONSTRAINT "provider_login_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_login_requests_org_host_idx" ON "provider_login_requests" USING btree ("organization_id","host_id");--> statement-breakpoint
CREATE INDEX "provider_login_requests_org_user_idx" ON "provider_login_requests" USING btree ("organization_id","user_id");