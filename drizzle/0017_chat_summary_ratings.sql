ALTER TABLE "chat" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "summary_seq" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "rating_reason" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "rated_at" timestamp;--> statement-breakpoint
CREATE INDEX "message_rated_idx" ON "message" USING btree ("rated_at");