CREATE TABLE "thoughts_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"file_path" text NOT NULL,
	"title" text NOT NULL,
	"created_at" integer,
	"organization_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thoughts_documents_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"thoughts_document_id" text,
	"op" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ydoc_awareness" (
	"client_id" text,
	"thoughts_document_id" text NOT NULL,
	"op" "bytea" NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "ydoc_awareness_client_id_thoughts_document_id_pk" PRIMARY KEY("client_id","thoughts_document_id")
);
--> statement-breakpoint
ALTER TABLE "thoughts_documents_operations" ADD CONSTRAINT "thoughts_documents_operations_thoughts_document_id_thoughts_documents_id_fk" FOREIGN KEY ("thoughts_document_id") REFERENCES "public"."thoughts_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ydoc_awareness" ADD CONSTRAINT "ydoc_awareness_thoughts_document_id_thoughts_documents_id_fk" FOREIGN KEY ("thoughts_document_id") REFERENCES "public"."thoughts_documents"("id") ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

--> statement-breakpoint
-- create function to clean up old awareness data
CREATE OR REPLACE FUNCTION delete_old_rows()
RETURNS TRIGGER AS $$
BEGIN
	DELETE FROM ydoc_awareness
	WHERE updated_at < NOW() - INTERVAL '2 minutes';
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for cleanup
CREATE TRIGGER delete_old_rows_trigger
AFTER INSERT OR UPDATE ON ydoc_awareness
FOR EACH STATEMENT
EXECUTE FUNCTION delete_old_rows();
