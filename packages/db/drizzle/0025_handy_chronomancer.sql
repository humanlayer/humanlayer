CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"experimental_subagents_enabled" boolean DEFAULT false NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
DROP INDEX "user_settings_user_id_index";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "organization_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_pk" PRIMARY KEY("user_id","organization_id");--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "theme" text DEFAULT 'catppuccin' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "experimental_subagents_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;