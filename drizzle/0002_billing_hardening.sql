CREATE TABLE "renewal_attempt" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period_end" timestamp NOT NULL,
	"payment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "anchor_day" integer;--> statement-breakpoint
ALTER TABLE "renewal_attempt" ADD CONSTRAINT "renewal_attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "renewal_attempt_user_idx" ON "renewal_attempt" USING btree ("user_id","period_end");