ALTER TABLE "artifact_comments" RENAME COLUMN "highlighted_text" TO "commented_upon_block_text";--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD COLUMN "previous_block_text" text;--> statement-breakpoint
ALTER TABLE "artifact_comments" ADD COLUMN "next_block_text" text;--> statement-breakpoint
ALTER TABLE "artifact_comments" DROP COLUMN "highlighted_text_line_number";--> statement-breakpoint
ALTER TABLE "artifact_comments" DROP COLUMN "highlighted_text_has_match_in_current_artifact";