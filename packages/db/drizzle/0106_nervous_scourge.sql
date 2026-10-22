CREATE TABLE "context_shards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"shard_text" text NOT NULL,
	"reasoning_text" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"released_to_org" boolean DEFAULT false NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"dismissed_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_shard_preferences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"shard_id" uuid NOT NULL,
	"shard_state" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "user_shard_preferences_org_user_shard_unique" UNIQUE("organization_id","user_id","shard_id")
);
--> statement-breakpoint
ALTER TABLE "context_shards" ADD CONSTRAINT "context_shards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_shard_preferences" ADD CONSTRAINT "user_shard_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_shard_preferences" ADD CONSTRAINT "user_shard_preferences_shard_id_context_shards_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."context_shards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_shards_org_released_idx" ON "context_shards" USING btree ("organization_id","released_to_org","dismissed","id");--> statement-breakpoint
CREATE INDEX "context_shards_org_review_idx" ON "context_shards" USING btree ("organization_id","dismissed","created_at","id");--> statement-breakpoint
CREATE INDEX "user_shard_preferences_shard_id_idx" ON "user_shard_preferences" USING btree ("shard_id");