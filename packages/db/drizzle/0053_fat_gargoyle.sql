ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "has_received_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "organizations_stripe_customer_id_index" ON "organizations" USING btree ("stripe_customer_id");