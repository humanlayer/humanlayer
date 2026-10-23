ALTER TABLE "artifacts" ADD COLUMN "frontmatter" jsonb DEFAULT '{}'::jsonb NOT NULL;
