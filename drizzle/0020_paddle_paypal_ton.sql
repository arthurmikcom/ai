CREATE TABLE "purchase" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"plan" text,
	"credits" integer,
	"usd" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"code" text,
	"external_id" text,
	"status" text NOT NULL,
	"applied_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_code_unique" UNIQUE("code"),
	CONSTRAINT "purchase_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "paddle_customer_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "paddle_subscription_id" text;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_user_idx" ON "purchase" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_pending_idx" ON "purchase" USING btree ("provider","status");--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_paddle_subscription_id_unique" UNIQUE("paddle_subscription_id");