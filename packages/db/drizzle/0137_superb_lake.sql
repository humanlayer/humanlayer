CREATE TYPE "public"."artifact_public_permission" AS ENUM('off', 'view', 'comment');--> statement-breakpoint
CREATE TABLE "anonymous_artifact_commenters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artifact_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_comment_undo_authorizations" (
	"comment_id" uuid PRIMARY KEY NOT NULL,
	"token_digest" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_comments" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD COLUMN "anonymous_author_id" uuid;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD COLUMN "anonymous_guest_name" text;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD COLUMN "created_via_public_share" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "public_permission" "artifact_public_permission" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "anonymous_artifact_commenters" ADD CONSTRAINT "anonymous_artifact_commenters_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_comment_undo_authorizations" ADD CONSTRAINT "public_comment_undo_authorizations_comment_id_artifact_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."artifact_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anonymous_artifact_commenters_artifact_id_id_idx" ON "anonymous_artifact_commenters" USING btree ("artifact_id","id");--> statement-breakpoint
CREATE INDEX "public_comment_undo_authorizations_expires_at_idx" ON "public_comment_undo_authorizations" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_anonymous_author_fk" FOREIGN KEY ("artifact_id","anonymous_author_id") REFERENCES "public"."anonymous_artifact_commenters"("artifact_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD CONSTRAINT "artifact_comments_exactly_one_author_check" CHECK ((("artifact_comments"."created_by_user_id" IS NOT NULL AND "artifact_comments"."anonymous_author_id" IS NULL AND "artifact_comments"."anonymous_guest_name" IS NULL) OR ("artifact_comments"."created_by_user_id" IS NULL AND "artifact_comments"."anonymous_author_id" IS NOT NULL AND "artifact_comments"."anonymous_guest_name" IS NOT NULL)));